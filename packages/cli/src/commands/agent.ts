import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import readline from "node:readline";
import type { ChatMessage } from "../utils/ollama.js";
import {
  getProvider,
  getModelInfo,
  aiChat,
  aiChatStream,
  type AIProvider,
} from "../utils/ai-provider.js";
import {
  collectContext,
  formatContextForPrompt,
  type CollectedContext,
} from "../utils/collectors.js";
import { findProjectDir } from "../utils/config.js";

const SYSTEM_PROMPT = `You are a helpful infrastructure assistant for the blissful-infra project. You help developers understand their application logs, diagnose issues, and suggest improvements.

When analyzing logs or issues:
1. Look for error messages, exceptions, and stack traces
2. Identify patterns in the logs (repeated errors, timing issues)
3. Correlate with recent code changes if commits are provided
4. Suggest specific, actionable fixes when possible

Keep responses concise and focused. Use markdown formatting for code blocks and lists.`;

interface AgentOptions {
  query?: string;
  model?: string;
  provider?: string;
}

async function runSingleQuery(
  query: string,
  provider: AIProvider,
  model: string,
  context: CollectedContext
): Promise<void> {
  const spinner = ora("Analyzing...").start();

  try {
    const contextText = formatContextForPrompt(context);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${contextText}\n\n---\n\nQuestion: ${query}`,
      },
    ];

    const response = await aiChat(provider, model, messages);
    spinner.stop();

    console.log();
    console.log(response);
    console.log();
  } catch (error) {
    spinner.fail("Analysis failed");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

async function runInteractiveMode(
  provider: AIProvider,
  model: string,
  context: CollectedContext,
  projectDir: string
): Promise<void> {
  console.log();
  console.log(chalk.bold("Blissful Infra Agent"));
  console.log(chalk.dim("Provider: ") + chalk.cyan(provider === "claude" ? "Claude" : "Ollama"));
  console.log(chalk.dim("Model: ") + chalk.cyan(model));
  console.log(chalk.dim(`Context: ${context.logs.length} log entries, ${context.commits.length} commits`));
  console.log(chalk.dim('Type "help" for commands, "exit" to quit'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add initial context
  const contextText = formatContextForPrompt(context);
  if (contextText) {
    history.push({
      role: "user",
      content: `Here is the current context from the project:\n\n${contextText}\n\nI'll be asking you questions about this. Please acknowledge.`,
    });
    history.push({
      role: "assistant",
      content: "I've reviewed the logs and recent commits. I'm ready to help you analyze issues, understand the logs, or answer questions about your infrastructure. What would you like to know?",
    });
  }

  const prompt = (): void => {
    rl.question(chalk.cyan("> "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle special commands
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.dim("Goodbye!"));
        rl.close();
        return;
      }

      if (trimmed === "help") {
        console.log();
        console.log(chalk.bold("Commands:"));
        console.log(chalk.dim("  help     ") + "Show this help");
        console.log(chalk.dim("  refresh  ") + "Refresh logs and context");
        console.log(chalk.dim("  logs     ") + "Show recent logs");
        console.log(chalk.dim("  commits  ") + "Show recent commits");
        console.log(chalk.dim("  clear    ") + "Clear conversation history");
        console.log(chalk.dim("  exit     ") + "Exit the agent");
        console.log();
        console.log(chalk.bold("Example questions:"));
        console.log(chalk.dim('  "What errors are in the logs?"'));
        console.log(chalk.dim('  "Why might the app be failing to start?"'));
        console.log(chalk.dim('  "What changed in the last few commits?"'));
        console.log();
        prompt();
        return;
      }

      if (trimmed === "refresh") {
        const spinner = ora("Refreshing context...").start();
        const newContext = await collectContext(projectDir);
        context.logs = newContext.logs;
        context.commits = newContext.commits;
        spinner.succeed(
          `Refreshed: ${context.logs.length} logs, ${context.commits.length} commits`
        );
        prompt();
        return;
      }

      if (trimmed === "logs") {
        console.log();
        if (context.logs.length === 0) {
          console.log(chalk.dim("No logs collected."));
        } else {
          const recent = context.logs.slice(-20);
          for (const log of recent) {
            console.log(
              chalk.dim(`[${log.service}]`) + " " + log.message.slice(0, 100)
            );
          }
          if (context.logs.length > 20) {
            console.log(chalk.dim(`... and ${context.logs.length - 20} more`));
          }
        }
        console.log();
        prompt();
        return;
      }

      if (trimmed === "commits") {
        console.log();
        if (context.commits.length === 0) {
          console.log(chalk.dim("No commits found."));
        } else {
          for (const commit of context.commits) {
            console.log(
              chalk.yellow(commit.sha.slice(0, 7)) +
                " " +
                chalk.dim(`(${commit.author})`) +
                " " +
                commit.message
            );
          }
        }
        console.log();
        prompt();
        return;
      }

      if (trimmed === "clear") {
        // Reset history but keep system prompt
        history.length = 1;
        console.log(chalk.dim("Conversation history cleared."));
        prompt();
        return;
      }

      // Regular query - send to LLM
      history.push({ role: "user", content: trimmed });

      process.stdout.write(chalk.dim("\n"));

      try {
        let response = "";
        for await (const chunk of aiChatStream(provider, model, history)) {
          process.stdout.write(chunk);
          response += chunk;
        }
        process.stdout.write("\n\n");

        history.push({ role: "assistant", content: response });
      } catch (error) {
        console.log();
        if (error instanceof Error) {
          console.error(chalk.red(`Error: ${error.message}`));
        }
        // Remove failed user message from history
        history.pop();
      }

      prompt();
    });
  };

  prompt();
}

export async function agentAction(name?: string, opts: AgentOptions = {}): Promise<void> {
  // Find the best available AI provider
  const preferredProvider = opts.provider as AIProvider | undefined;
  const providerType = await getProvider(preferredProvider);

  if (!providerType) {
    if (preferredProvider) {
      console.error(chalk.red(`${preferredProvider === "claude" ? "Claude" : "Ollama"} is not available.`));
    } else {
      console.error(chalk.red("No AI provider available."));
    }
    console.error();
    console.error(chalk.dim("Options:"));
    console.error(chalk.cyan("  1. Install Claude Code + 'claude login'") + chalk.dim(" — uses your Claude.ai subscription, no API key needed"));
    console.error(chalk.cyan("  2. Set ANTHROPIC_API_KEY") + chalk.dim("             — Anthropic API plan"));
    console.error(chalk.cyan("  3. Set ANTHROPIC_AUTH_TOKEN") + chalk.dim("           — OAuth bearer token"));
    console.error(chalk.cyan("  4. Run 'ollama serve'") + chalk.dim("                  — local Ollama"));
    process.exit(1);
  }

  // Select model
  const modelInfo = await getModelInfo(opts.model, providerType);
  if (!modelInfo) {
    console.error(chalk.red("No language models available."));
    if (providerType === "ollama") {
      console.error(chalk.dim("Pull a model first:"));
      console.error(chalk.cyan("  ollama pull llama3.1:8b"));
    }
    process.exit(1);
  }

  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra agent my-app"));
    }
    process.exit(1);
  }

  // Collect context
  const spinner = ora("Collecting context...").start();
  const context = await collectContext(projectDir);
  spinner.succeed(context.summary);

  // Run in query mode or interactive mode
  if (opts.query) {
    await runSingleQuery(opts.query, modelInfo.provider, modelInfo.model, context);
  } else {
    await runInteractiveMode(modelInfo.provider, modelInfo.model, context, projectDir);
  }
}

// --- Virtual Employee subcommands (Phase 7) ---

const AGENT_SERVICE_URL = "http://localhost:8095";

async function hireAction(role: string, opts: { name?: string; port?: string }): Promise<void> {
  if (!opts.name) {
    console.error(chalk.red("--name is required"));
    console.error(chalk.dim("Usage: blissful-infra agent hire <role> --name <name>"));
    process.exit(1);
  }

  const spinner = ora(`Hiring ${role} "${opts.name}"...`).start();
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: opts.name, role }),
    });
    if (!response.ok) {
      const err = await response.json() as { detail?: string };
      throw new Error(err.detail || `HTTP ${response.status}`);
    }
    spinner.succeed(`Virtual employee "${opts.name}" (${role}) is online`);
  } catch (error) {
    spinner.fail(`Failed to hire "${opts.name}"`);
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    if (error instanceof TypeError && error.message.includes("fetch")) {
      console.error(chalk.dim("Is the agent-service running? Start with: --plugins agent-service"));
    }
  }
}

async function fireAction(name: string): Promise<void> {
  const spinner = ora(`Firing "${name}"...`).start();
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents/${name}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const err = await response.json() as { detail?: string };
      throw new Error(err.detail || `HTTP ${response.status}`);
    }
    spinner.succeed(`Virtual employee "${name}" terminated`);
  } catch (error) {
    spinner.fail(`Failed to fire "${name}"`);
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

async function listAction(): Promise<void> {
  const spinner = ora("Fetching agents...").start();
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const agents = await response.json() as Array<{
      name: string; role: string; status: string;
      current_task?: { description: string; status: string };
      created_at: string;
    }>;
    spinner.stop();

    if (agents.length === 0) {
      console.log(chalk.dim("No virtual employees active."));
      console.log(chalk.dim("Hire one with: blissful-infra agent hire feature-engineer --name alice"));
      return;
    }

    console.log();
    console.log(chalk.bold("Virtual Employees"));
    console.log();
    console.log(
      chalk.dim("Name".padEnd(20) + "Role".padEnd(22) + "Status".padEnd(18) + "Task")
    );
    console.log(chalk.dim("-".repeat(75)));

    for (const agent of agents) {
      const statusColor = agent.status === "idle" ? chalk.green :
        agent.status === "working" ? chalk.yellow :
        agent.status === "awaiting-review" ? chalk.cyan :
        chalk.red;

      const taskDesc = agent.current_task?.description?.slice(0, 30) || "-";
      console.log(
        chalk.white(agent.name.padEnd(20)) +
        chalk.dim(agent.role.padEnd(22)) +
        statusColor(agent.status.padEnd(18)) +
        chalk.dim(taskDesc)
      );
    }
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch agents");
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

async function assignAction(name: string, task: string): Promise<void> {
  const spinner = ora(`Assigning task to ${name}...`).start();
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents/${name}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: task }),
    });
    if (!response.ok) {
      const err = await response.json() as { detail?: string };
      throw new Error(err.detail || `HTTP ${response.status}`);
    }
    const result = await response.json() as { task_id: string };
    spinner.succeed(`Task assigned to ${name} (${result.task_id})`);
    console.log(chalk.dim(`Check progress: blissful-infra agent status ${name}`));
  } catch (error) {
    spinner.fail(`Failed to assign task to ${name}`);
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

async function reviewAction(name: string): Promise<void> {
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents/${name}/suggestion`);
    if (!response.ok) {
      if (response.status === 404) {
        const err = await response.json() as { detail?: string };
        console.error(chalk.red(err.detail || `No suggestion available for "${name}".`));
        console.error(chalk.dim(`Check agent status: blissful-infra agent status ${name}`));
      } else {
        console.error(chalk.red(`HTTP ${response.status}`));
      }
      return;
    }

    const suggestion = await response.json() as {
      plan: string;
      revision: number;
      changes: Array<{ path: string; content: string; description: string; diff?: string }>;
    };

    console.log();
    console.log(chalk.bold(`Suggestion v${suggestion.revision}`) + chalk.dim(` — ${name}`));
    console.log();
    console.log(chalk.bold("Plan:"));
    for (const line of suggestion.plan.split("\n")) {
      console.log("  " + line);
    }
    console.log();
    console.log(chalk.bold(`Proposed Changes (${suggestion.changes.length} file${suggestion.changes.length === 1 ? "" : "s"}):`));

    for (const change of suggestion.changes) {
      const hasRemovals = change.diff ? change.diff.split("\n").some(l => l.startsWith("-") && !l.startsWith("---")) : false;
      const label = hasRemovals ? chalk.yellow("MOD") : chalk.green("NEW");
      console.log();
      console.log(chalk.dim("─".repeat(60)));
      console.log(`${label} ${chalk.cyan(change.path)}`);
      if (change.description) {
        console.log(chalk.dim("    " + change.description));
      }
      console.log();

      const diffText = change.diff || change.content.split("\n").map(l => `+${l}`).join("\n");
      for (const line of diffText.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) {
          process.stdout.write(chalk.dim(line) + "\n");
        } else if (line.startsWith("+")) {
          process.stdout.write(chalk.green(line) + "\n");
        } else if (line.startsWith("-")) {
          process.stdout.write(chalk.red(line) + "\n");
        } else if (line.startsWith("@@")) {
          process.stdout.write(chalk.cyan(line) + "\n");
        } else {
          process.stdout.write(chalk.dim(line) + "\n");
        }
      }
    }

    console.log();
    console.log(chalk.dim("─".repeat(60)));
    console.log();
    console.log(chalk.dim("Next steps:"));
    console.log(`  ${chalk.cyan(`blissful-infra agent accept ${name}`)}        apply changes, create branch + PR`);
    console.log(`  ${chalk.cyan(`blissful-infra agent revise ${name} "..."`)}  send feedback, agent will revise`);
    console.log(`  ${chalk.cyan(`blissful-infra agent reject ${name}`)}        discard suggestion`);
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    if (error instanceof TypeError && (error as TypeError).message.includes("fetch")) {
      console.error(chalk.dim("Is the agent-service running? Start with: --plugins agent-service"));
    }
  }
}

async function statusAction(name: string): Promise<void> {
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/agents/${name}`);
    if (!response.ok) {
      if (response.status === 404) {
        console.error(chalk.red(`Agent "${name}" not found.`));
      } else {
        console.error(chalk.red(`HTTP ${response.status}`));
      }
      return;
    }
    const agent = await response.json() as {
      name: string; role: string; status: string;
      current_task?: {
        description: string; status: string;
        steps: Array<{ description: string; status: string }>;
        created_at: string; completed_at?: string;
      };
    };

    console.log();
    const statusColor = agent.status === "idle" ? chalk.green :
      agent.status === "working" ? chalk.yellow :
      agent.status === "awaiting-review" ? chalk.cyan :
      chalk.red;

    console.log(chalk.bold(`Agent: ${agent.name}`) + chalk.dim(` (${agent.role})`));
    console.log(chalk.dim("Status: ") + statusColor(agent.status));

    if (agent.current_task) {
      console.log(chalk.dim("Current Task: ") + chalk.white(agent.current_task.description));
      console.log();

      if (agent.current_task.steps.length > 0) {
        console.log(chalk.bold("Progress:"));
        for (const step of agent.current_task.steps) {
          const icon = step.status === "completed" ? chalk.green("  ✓") :
            step.status === "in-progress" ? chalk.yellow("  ◦") :
            chalk.dim("  ○");
          console.log(`${icon} ${step.description}`);
        }
      }

      if (agent.status === "awaiting-review") {
        console.log();
        console.log(chalk.cyan("→ Waiting for human approval"));
      }
    } else {
      console.log(chalk.dim("No active task."));
    }
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
  }
}

// --- Command registration ---

export const agentCommand = new Command("agent")
  .description("AI agents and virtual employees")
  .addCommand(
    new Command("chat")
      .description("Interactive AI assistant for debugging")
      .argument("[name]", "Project name (if running from parent directory)")
      .option("-q, --query <query>", "Single query mode (non-interactive)")
      .option("-m, --model <model>", "Override model selection")
      .option("-p, --provider <provider>", "AI provider: claude or ollama")
      .action(async (name: string | undefined, opts: AgentOptions) => {
        await agentAction(name, opts);
      })
  )
  .addCommand(
    new Command("hire")
      .description("Hire a virtual employee")
      .argument("<role>", "Agent role (feature-engineer)")
      .option("-n, --name <name>", "Agent name (required)")
      .option("--port <port>", "Agent service port", "8095")
      .action(hireAction)
  )
  .addCommand(
    new Command("fire")
      .description("Fire a virtual employee")
      .argument("<name>", "Agent name")
      .action(fireAction)
  )
  .addCommand(
    new Command("list")
      .description("List active virtual employees")
      .action(listAction)
  )
  .addCommand(
    new Command("assign")
      .description("Assign a task to a virtual employee")
      .argument("<name>", "Agent name")
      .argument("<task>", "Task description")
      .action(assignAction)
  )
  .addCommand(
    new Command("status")
      .description("Show agent progress and task details")
      .argument("<name>", "Agent name")
      .action(statusAction)
  )
  .addCommand(
    new Command("review")
      .description("View proposed changes from a virtual employee")
      .argument("<name>", "Agent name")
      .action(reviewAction)
  );
