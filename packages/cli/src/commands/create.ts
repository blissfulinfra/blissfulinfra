import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { copyTemplate, getAvailableTemplates } from "../utils/template.js";
import { parsePluginSpecs, serializePluginSpecs, type PluginInstance } from "../utils/config.js";

interface ProjectOptions {
  name: string;
  template: string;
  backend?: string;
  frontend?: string;
  database: string;
  deployTarget: string;
  plugins: PluginInstance[];
}

const BACKEND_TEMPLATES = [
  {
    name: "spring-boot",
    description: "Kotlin + Spring Boot + Kafka + WebSockets",
  },
  {
    name: "lambda-python",
    description: "Serverless Python on LocalStack",
  },
] as const;

const FRONTEND_TEMPLATES = [
  {
    name: "react-vite",
    description: "React + Vite + TypeScript + TailwindCSS",
  },
  {
    name: "none",
    description: "No frontend",
  },
] as const;

const PROJECT_TYPES = [
  { name: "fullstack", description: "Backend + Frontend monorepo" },
  { name: "backend", description: "Backend API only" },
  { name: "frontend", description: "Frontend only (static site)" },
] as const;

const DATABASES = [
  { name: "none", description: "No database" },
  { name: "postgres", description: "PostgreSQL" },
  { name: "redis", description: "Redis" },
  { name: "postgres-redis", description: "PostgreSQL + Redis" },
] as const;

const DEPLOY_TARGETS = [
  { name: "local-only", description: "Docker Compose" },
  { name: "kubernetes", description: "Argo CD + Kind for local" },
  { name: "cloud", description: "EKS/GKE/AKS" },
] as const;

interface CommandOptions {
  template?: string;
  backend?: string;
  frontend?: string;
  database?: string;
  deploy?: string;
  plugins?: string;
}

async function promptForOptions(
  providedName?: string,
  opts?: CommandOptions
): Promise<ProjectOptions> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions: any[] = [];
  const answers: Record<string, string> = {};

  // Project name
  if (!providedName) {
    questions.push({
      type: "input",
      name: "name",
      message: "Project name:",
      default: "my-app",
      validate: (input: string) => {
        if (!input.trim()) return "Project name is required";
        if (!/^[a-z0-9-]+$/.test(input))
          return "Project name must be lowercase alphanumeric with hyphens";
        return true;
      },
    });
  }

  // Project type
  if (!opts?.template) {
    questions.push({
      type: "list",
      name: "template",
      message: "Project type:",
      choices: PROJECT_TYPES.map((t) => ({
        name: `${t.name.padEnd(12)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    });
  }

  // Get initial answers to determine follow-up questions
  if (questions.length > 0) {
    Object.assign(answers, await inquirer.prompt(questions));
  }

  const projectType = opts?.template || answers.template;

  // Backend selection (for fullstack or backend-only)
  if (projectType !== "frontend" && !opts?.backend) {
    const backendAnswer = await inquirer.prompt([{
      type: "list",
      name: "backend",
      message: "Select backend framework:",
      choices: BACKEND_TEMPLATES.map((t) => ({
        name: `${t.name.padEnd(12)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    }]);
    answers.backend = backendAnswer.backend;
  }

  // Frontend selection (for fullstack or frontend-only)
  if (projectType !== "backend" && !opts?.frontend) {
    const frontendChoices = projectType === "frontend"
      ? FRONTEND_TEMPLATES.filter(t => t.name !== "none")
      : FRONTEND_TEMPLATES;

    const frontendAnswer = await inquirer.prompt([{
      type: "list",
      name: "frontend",
      message: "Select frontend framework:",
      choices: frontendChoices.map((t) => ({
        name: `${t.name.padEnd(12)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    }]);
    answers.frontend = frontendAnswer.frontend;
  }

  // Database selection (skip for frontend-only)
  if (projectType !== "frontend" && !opts?.database) {
    const dbAnswer = await inquirer.prompt([{
      type: "list",
      name: "database",
      message: "Include database?",
      choices: DATABASES.map((d) => ({
        name: `${d.name.padEnd(15)} ${chalk.dim(`(${d.description})`)}`,
        value: d.name,
      })),
    }]);
    answers.database = dbAnswer.database;
  }

  // Deploy target
  if (!opts?.deploy) {
    const deployAnswer = await inquirer.prompt([{
      type: "list",
      name: "deployTarget",
      message: "Deployment target:",
      choices: DEPLOY_TARGETS.map((t) => ({
        name: `${t.name.padEnd(15)} ${chalk.dim(`(${t.description})`)}`,
        value: t.name,
      })),
    }]);
    answers.deployTarget = deployAnswer.deployTarget;
  }

  return {
    name: providedName || answers.name,
    template: projectType,
    backend: opts?.backend || answers.backend,
    frontend: opts?.frontend || answers.frontend,
    database: projectType === "frontend" ? "none" : (opts?.database || answers.database),
    deployTarget: opts?.deploy || answers.deployTarget,
    plugins: opts?.plugins ? parsePluginSpecs(opts.plugins.split(",").map(p => p.trim())) : [],
  };
}

async function scaffoldProject(options: ProjectOptions): Promise<void> {
  const spinner = ora(`Scaffolding project in ./${options.name}...`).start();

  const projectDir = path.resolve(process.cwd(), options.name);

  // Check if directory exists
  try {
    await fs.access(projectDir);
    spinner.fail(`Directory ${options.name} already exists`);
    process.exit(1);
  } catch {
    // Directory doesn't exist, good to proceed
  }

  // Create project directory
  await fs.mkdir(projectDir, { recursive: true });

  const availableTemplates = getAvailableTemplates();
  const isFullstack = options.template === "fullstack";
  const isBackendOnly = options.template === "backend";
  const isFrontendOnly = options.template === "frontend";

  // Copy backend template
  if ((isFullstack || isBackendOnly) && options.backend) {
    const backendDir = isFullstack ? path.join(projectDir, "backend") : projectDir;

    if (isFullstack) {
      await fs.mkdir(backendDir, { recursive: true });
    }

    if (availableTemplates.includes(options.backend)) {
      spinner.text = `Copying ${options.backend} backend template...`;
      await copyTemplate(options.backend, backendDir, {
        projectName: options.name,
        database: options.database,
        deployTarget: options.deployTarget,
      });
    } else {
      await fs.mkdir(path.join(backendDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(backendDir, "src", ".gitkeep"),
        `# Backend template '${options.backend}' coming soon\n`
      );
    }
  }

  // Copy frontend template
  if ((isFullstack || isFrontendOnly) && options.frontend && options.frontend !== "none") {
    const frontendDir = isFullstack ? path.join(projectDir, "frontend") : projectDir;

    if (isFullstack) {
      await fs.mkdir(frontendDir, { recursive: true });
    }

    if (availableTemplates.includes(options.frontend)) {
      spinner.text = `Copying ${options.frontend} frontend template...`;
      await copyTemplate(options.frontend, frontendDir, {
        projectName: options.name,
        database: options.database,
        deployTarget: options.deployTarget,
      });
    } else {
      await fs.mkdir(path.join(frontendDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(frontendDir, "src", ".gitkeep"),
        `# Frontend template '${options.frontend}' coming soon\n`
      );
    }
  }

  // Copy plugin templates
  for (const plugin of options.plugins) {
    const pluginDir = path.join(projectDir, plugin.instance);
    if (availableTemplates.includes(plugin.type)) {
      spinner.text = `Copying ${plugin.instance} plugin...`;
      await fs.mkdir(pluginDir, { recursive: true });
      await copyTemplate(plugin.type, pluginDir, {
        projectName: options.name,
        database: options.database,
        deployTarget: options.deployTarget,
        instanceName: plugin.instance,
        apiPort: 8090 + options.plugins.filter(p => p.type === plugin.type).indexOf(plugin),
      });
    }
  }

  // Create blissful-infra.yaml config
  const configLines = [
    "# Blissful Infra Configuration",
    `name: ${options.name}`,
    `type: ${options.template}`,
  ];

  if (options.backend) {
    configLines.push(`backend: ${options.backend}`);
  }
  if (options.frontend && options.frontend !== "none") {
    configLines.push(`frontend: ${options.frontend}`);
  }

  configLines.push(
    `database: ${options.database}`,
    `deploy_target: ${options.deployTarget}`,
  );

  if (options.plugins.length > 0) {
    configLines.push(`plugins: ${serializePluginSpecs(options.plugins)}`);
  }

  configLines.push(
    "",
    "# Agent configuration (Phase 1.4)",
    "# agent:",
    "#   provider: ollama",
    "#   model: llama3.1:8b",
    "#   endpoint: http://localhost:11434",
  );

  await fs.writeFile(
    path.join(projectDir, "blissful-infra.yaml"),
    configLines.join("\n") + "\n"
  );

  // Create appropriate README based on project type
  const readmeContent = generateReadme(options);
  await fs.writeFile(path.join(projectDir, "README.md"), readmeContent);

  // Create root .gitignore for fullstack projects
  if (isFullstack) {
    await fs.writeFile(
      path.join(projectDir, ".gitignore"),
      `# Dependencies
node_modules/

# Build outputs
dist/
build/
.gradle/
target/

# IDE
.idea/
.vscode/
*.iml

# Environment
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Docker
docker-compose.override.yaml
`
    );
  }

  spinner.succeed(`Scaffolded project in ./${options.name}`);

  console.log();
  console.log(chalk.green("Done!"), "Now run:");
  console.log();
  console.log(chalk.cyan(`  cd ${options.name}`));
  console.log(chalk.cyan("  blissful-infra up"));
  console.log();
}

function generateReadme(options: ProjectOptions): string {
  const isFullstack = options.template === "fullstack";
  const isFrontendOnly = options.template === "frontend";

  let readme = `# ${options.name}

Generated with [blissful-infra](https://github.com/you/blissful-infra).

## Project Structure

`;

  if (isFullstack) {
    readme += `\`\`\`
${options.name}/
├── backend/          # ${options.backend} API
├── frontend/         # ${options.frontend} app
├── blissful-infra.yaml
└── docker-compose.yaml (generated)
\`\`\`

`;
  }

  readme += `## Quick Start

\`\`\`bash
# Start local environment
blissful-infra up

# Development mode (hot reload)
blissful-infra dev

# View logs
blissful-infra logs

# Stop environment
blissful-infra down
\`\`\`

## Services

`;

  if (isFrontendOnly) {
    readme += `| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
`;
  } else if (isFullstack) {
    readme += `| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| Kafka | localhost:9092 |
`;
    if (options.database === "postgres" || options.database === "postgres-redis") {
      readme += `| PostgreSQL | localhost:5432 |\n`;
    }
    if (options.database === "redis" || options.database === "postgres-redis") {
      readme += `| Redis | localhost:6379 |\n`;
    }
  } else {
    readme += `| Service | URL |
|---------|-----|
| API | http://localhost:8080 |
| Kafka | localhost:9092 |
`;
    if (options.database === "postgres" || options.database === "postgres-redis") {
      readme += `| PostgreSQL | localhost:5432 |\n`;
    }
    if (options.database === "redis" || options.database === "postgres-redis") {
      readme += `| Redis | localhost:6379 |\n`;
    }
  }

  if (!isFrontendOnly) {
    readme += `
## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/health\` | GET | Health check |
| \`/ready\` | GET | Kubernetes readiness probe |
| \`/live\` | GET | Kubernetes liveness probe |
| \`/hello\` | GET | Returns "Hello, World!" |
| \`/hello/:name\` | GET | Returns personalized greeting |
| \`/echo\` | POST | Echoes request body |
| \`/ws/events\` | WS | WebSocket for real-time events |
`;
  }

  readme += `
## Configuration

See \`blissful-infra.yaml\` for project settings.

- **Type:** ${options.template}
`;

  if (options.backend) {
    readme += `- **Backend:** ${options.backend}\n`;
  }
  if (options.frontend && options.frontend !== "none") {
    readme += `- **Frontend:** ${options.frontend}\n`;
  }

  readme += `- **Database:** ${options.database}
- **Deploy Target:** ${options.deployTarget}
`;

  return readme;
}

export const createCommand = new Command("create")
  .description("Create a new blissful-infra project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Project type (fullstack, backend, frontend)")
  .option("-b, --backend <backend>", "Backend template (spring-boot, lambda-python)")
  .option("-f, --frontend <frontend>", "Frontend template (react-vite, none)")
  .option("-d, --database <database>", "Database to include (none, postgres, redis, postgres-redis)")
  .option("--deploy <target>", "Deployment target (local-only, kubernetes, cloud)")
  .option("-p, --plugins <plugins>", "Comma-separated plugins (e.g. ai-pipeline)")
  .action(async (name?: string, opts?: CommandOptions) => {
    console.log();
    console.log(
      chalk.bold("⚡ blissful-infra"),
      chalk.dim("- Infrastructure that thinks for itself")
    );
    console.log();

    // Validate template if provided
    if (opts?.template) {
      const validTypes = PROJECT_TYPES.map((t) => t.name);
      if (!validTypes.includes(opts.template as (typeof PROJECT_TYPES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid project type: ${opts.template}`),
          chalk.dim(`\nValid types: ${validTypes.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate backend if provided
    if (opts?.backend) {
      const validBackends = BACKEND_TEMPLATES.map((t) => t.name);
      if (!validBackends.includes(opts.backend as (typeof BACKEND_TEMPLATES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid backend: ${opts.backend}`),
          chalk.dim(`\nValid backends: ${validBackends.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate frontend if provided
    if (opts?.frontend) {
      const validFrontends = FRONTEND_TEMPLATES.map((t) => t.name);
      if (!validFrontends.includes(opts.frontend as (typeof FRONTEND_TEMPLATES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid frontend: ${opts.frontend}`),
          chalk.dim(`\nValid frontends: ${validFrontends.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate database if provided
    if (opts?.database) {
      const validDatabases = DATABASES.map((d) => d.name);
      if (!validDatabases.includes(opts.database as (typeof DATABASES)[number]["name"])) {
        console.error(
          chalk.red(`Invalid database: ${opts.database}`),
          chalk.dim(`\nValid databases: ${validDatabases.join(", ")}`)
        );
        process.exit(1);
      }
    }

    // Validate deploy target if provided
    if (opts?.deploy) {
      const validTargets = DEPLOY_TARGETS.map((t) => t.name);
      if (!validTargets.includes(opts.deploy as (typeof DEPLOY_TARGETS)[number]["name"])) {
        console.error(
          chalk.red(`Invalid deploy target: ${opts.deploy}`),
          chalk.dim(`\nValid targets: ${validTargets.join(", ")}`)
        );
        process.exit(1);
      }
    }

    const options = await promptForOptions(name, opts);
    await scaffoldProject(options);
  });
