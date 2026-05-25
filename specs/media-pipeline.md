# Media Pipeline - Blissful Infra Integration Spec

## Overview

Add a Temporal-orchestrated media pipeline to Blissful Infra. The pipeline takes a topic as input and produces blog content, social posts and a generated image - with each step visible in both the Temporal UI and the Blissful Infra developer dashboard.

This is a natural extension of what Blissful Infra already provides: a full local dev environment with observability built in. Adding Temporal and LiteLLM as first-class services completes the AI infrastructure story.

---

## What Gets Added

### New Docker Services (docker-compose.yml)

**Temporal server + dependencies**
- `temporal` - Temporal server
- `temporal-ui` - Temporal web UI (port 8233)
- `temporal-postgres` - dedicated Postgres instance for Temporal (separate from app DB)

**LiteLLM proxy**
- `litellm` - OpenAI-compatible proxy (port 4000)
- Reads from `litellm-config.yaml` mounted as a volume
- Routes model aliases to Ollama backends

**Media worker**
- `media-worker` - Kotlin/Spring Boot Temporal worker
- Registers and runs all pipeline activities
- Calls LiteLLM and image gen endpoints

---

## LiteLLM Configuration

```yaml
# litellm-config.yaml
model_list:
  - model_name: writer-large
    litellm_params:
      model: ollama/llama3:70b
      api_base: http://host.docker.internal:11434

  - model_name: writer-fast
    litellm_params:
      model: ollama/llama3:8b
      api_base: http://host.docker.internal:11434

  - model_name: creative
    litellm_params:
      model: ollama/llama3:70b
      api_base: http://host.docker.internal:11434

litellm_settings:
  request_timeout: 120
  num_retries: 2
```

Model aliases map to Ollama running on the host. Swap `api_base` per alias to route to different machines/GPUs when available.

---

## Temporal Workflow

### Workflow: MediaPipeline

**Input:**
```kotlin
data class MediaPipelineInput(
    val topic: String,
    val platforms: List<String> = listOf("blog", "linkedin", "twitter"),
    val imageStyle: String = "professional, minimal, tech"
)
```

**Output:**
```kotlin
data class MediaPipelineOutput(
    val blog: String,
    val linkedin: String,
    val twitter: String,
    val imagePrompt: String,
    val imageUrl: String
)
```

**Execution plan:**
```
1. GenerateOutline(topic) → outline                          [sequential]
2. Parallel fan-out:
   a. WriteBlog(topic, outline)      → model=writer-large
   b. WriteLinkedIn(topic, outline)  → model=writer-fast
   c. WriteTwitter(topic, outline)   → model=writer-fast
3. GenerateImagePrompt(topic, outline) → prompt              [sequential]
4. GenerateImage(prompt)               → imageUrl            [sequential]
5. Return all outputs
```

Steps 2a, 2b, 2c run in parallel via Temporal's `Async.function`. Steps 1, 3, 4 are sequential gates.

---

## Activities

### LlmActivity

All LLM calls go through one activity class. Each method calls the LiteLLM proxy with a different model alias and system prompt.

```kotlin
interface LlmActivity {
    fun generateOutline(topic: String): String
    fun writeBlog(topic: String, outline: String): String
    fun writeLinkedIn(topic: String, outline: String): String
    fun writeTwitterThread(topic: String, outline: String): String
    fun generateImagePrompt(topic: String, outline: String): String
}
```

Implementation calls `http://litellm:4000/v1/chat/completions` with appropriate model name and prompt.

**Retry policy:** 3 attempts, 10s initial backoff, exponential. Schedule-to-close timeout: 5 minutes per activity.

### ImageActivity

```kotlin
interface ImageActivity {
    fun generateImage(prompt: String, style: String): String  // returns image URL or file path
}
```

**For local demo (no image gen GPU):** return a placeholder URL and log the prompt. The workflow completes end to end.

**For real implementation:** POST to ComfyUI API (`http://comfyui:8188/prompt`) or Automatic1111 (`/sdapi/v1/txt2img`). Add `comfyui` as another Docker service when ready.

---

## API Surface

Expose pipeline triggering via the existing Spring Boot API.

### POST /api/pipeline/media

**Request:**
```json
{
  "topic": "Why local AI inference is changing enterprise architecture",
  "platforms": ["blog", "linkedin", "twitter"],
  "imageStyle": "professional, minimal, tech"
}
```

**Response:**
```json
{
  "workflowId": "media-pipeline-abc123",
  "runId": "xyz789",
  "status": "RUNNING"
}
```

### GET /api/pipeline/media/{workflowId}

Returns current status and outputs if complete.

```json
{
  "workflowId": "media-pipeline-abc123",
  "status": "COMPLETED",
  "result": {
    "blog": "...",
    "linkedin": "...",
    "twitter": "...",
    "imagePrompt": "...",
    "imageUrl": "..."
  }
}
```

---

## Dashboard Integration

Add a "Pipelines" tab to the Blissful Infra developer dashboard. Shows:

- Active pipeline runs with status (RUNNING / COMPLETED / FAILED)
- Step-level progress - which activities are complete, running or pending
- Output preview for completed runs
- Link to Temporal UI for full event history

Poll `GET /api/pipeline/media/{workflowId}` every 3 seconds while status is RUNNING. Temporal UI is already available at `localhost:8233` for deep inspection.

---

## Worker Configuration (Spring Boot)

```kotlin
@Configuration
class TemporalConfig {

    @Bean
    fun workflowClient(): WorkflowClient {
        val service = WorkflowServiceStubs.newLocalServiceStubs()
        return WorkflowClient.newInstance(service)
    }

    @Bean
    fun workerFactory(client: WorkflowClient): WorkerFactory {
        val factory = WorkerFactory.newInstance(client)
        val worker = factory.newWorker("media-pipeline-queue")
        worker.registerWorkflowImplementationTypes(MediaPipelineWorkflowImpl::class.java)
        worker.registerActivitiesImplementations(
            LlmActivityImpl(liteLlmBaseUrl),
            ImageActivityImpl(imageGenBaseUrl)
        )
        factory.start()
        return factory
    }
}
```

---

## Environment Variables

```
LITELLM_BASE_URL=http://litellm:4000
IMAGE_GEN_BASE_URL=http://comfyui:8188   # or mock for local demo
TEMPORAL_HOST=temporal:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=media-pipeline-queue
```

---

## Implementation Order

1. Add Temporal server and UI to docker-compose - confirm UI loads at `localhost:8233`
2. Add LiteLLM service - confirm `/v1/models` returns configured aliases
3. Add `media-worker` Spring Boot module - register worker, no activities yet
4. Implement `LlmActivity` - test with a single `generateOutline` call
5. Implement `MediaPipelineWorkflow` - sequential first, then add parallel fan-out
6. Add remaining activities (`WriteLinkedIn`, `WriteTwitter`, `GenerateImagePrompt`)
7. Add `ImageActivity` with placeholder implementation
8. Add API endpoints (`POST /api/pipeline/media`, `GET` status)
9. Add Pipelines tab to dashboard
10. Swap placeholder image activity for real ComfyUI call

---

## Demo Script

1. Start Blissful Infra (`./start.sh`)
2. Open dashboard - confirm Temporal UI link in sidebar
3. POST to `/api/pipeline/media` with a topic
4. Open Temporal UI - watch activities fan out in real time
5. Poll status endpoint - see outputs arrive as activities complete
6. Show final output in dashboard Pipelines tab

The Temporal UI event history is the money shot - shows exactly which activities ran, in what order, how long each took and what they returned.

---

## Future Extensions

- **Multi-GPU routing:** Add a second Ollama backend in `litellm-config.yaml` and assign `writer-large` to the more capable machine
- **Human approval step:** Temporal signal between draft generation and publish - dashboard shows "waiting for approval" state
- **Publish activity:** POST to Ghost, Webflow or a CMS API
- **Scheduling:** Temporal cron workflow to run the pipeline on a schedule
- **ComfyUI service:** Add as a Docker service with a GPU-enabled base image when image gen is ready
