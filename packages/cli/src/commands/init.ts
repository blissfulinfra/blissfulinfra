import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs/promises";

interface InitOptions {
  yes?: boolean;
  name?: string;
  backend?: string;
  frontend?: string;
  database?: string;
  deployTarget?: string;
}

const BACKENDS = [
  { value: "spring-boot",  label: "Spring Boot", hint: "Kotlin + Spring Boot + Kafka" },
  { value: "fastapi",      label: "FastAPI",      hint: "Python + FastAPI + Kafka" },
  { value: "express",      label: "Express",      hint: "Node.js + TypeScript + Kafka" },
  { value: "go-chi",       label: "Go Chi",       hint: "Go + Chi router + Kafka" },
];

const FRONTENDS = [
  { value: "react-vite",  label: "React + Vite", hint: "React 19 + TypeScript + Tailwind" },
  { value: "nextjs",      label: "Next.js",       hint: "Next.js + TypeScript + Tailwind" },
  { value: "none",        label: "None",          hint: "API only" },
];

const DATABASES = [
  { value: "postgres",       label: "Postgres",        hint: "PostgreSQL" },
  { value: "redis",          label: "Redis",            hint: "Redis" },
  { value: "postgres-redis", label: "Postgres + Redis", hint: "Both" },
  { value: "none",           label: "None",             hint: "No database" },
];

const DEPLOY_TARGETS = [
  { value: "local-only",  label: "Local only",  hint: "Docker Compose, no cloud deploy" },
  { value: "cloudflare",  label: "Cloudflare",  hint: "Workers + Pages + D1" },
  { value: "vercel",      label: "Vercel",       hint: "Functions + Vercel Postgres" },
  { value: "aws",         label: "AWS",          hint: "ECS Fargate + RDS + CloudFront" },
];

function choices<T extends { value: string; label: string; hint: string }>(items: T[]) {
  return items.map(i => ({
    name: `${i.label.padEnd(18)} ${chalk.dim(i.hint)}`,
    value: i.value,
  }));
}

async function gatherOptions(cwd: string, opts: InitOptions): Promise<Answers> {
  const dirName = path.basename(cwd);
  const defaults = {
    name: dirName,
    backend: "spring-boot",
    frontend: "react-vite",
    database: "postgres",
    deployTarget: "local-only",
  };

  if (opts.yes) {
    return {
      name:         opts.name         ?? defaults.name,
      backend:      opts.backend      ?? defaults.backend,
      frontend:     opts.frontend     ?? defaults.frontend,
      database:     opts.database     ?? defaults.database,
      deployTarget: opts.deployTarget ?? defaults.deployTarget,
      enableApi: false,
    };
  }

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Project name:",
      default: opts.name ?? defaults.name,
      validate: (v: string) => {
        if (!v.trim()) return "Required";
        if (!/^[a-z0-9-]+$/.test(v.trim())) return "Lowercase alphanumeric + hyphens only";
        return true;
      },
    },
    {
      type: "list",
      name: "backend",
      message: "Backend framework:",
      default: opts.backend ?? defaults.backend,
      choices: choices(BACKENDS),
    },
    {
      type: "list",
      name: "frontend",
      message: "Frontend framework:",
      default: opts.frontend ?? defaults.frontend,
      choices: choices(FRONTENDS),
    },
    {
      type: "list",
      name: "database",
      message: "Database:",
      default: opts.database ?? defaults.database,
      choices: choices(DATABASES),
    },
    {
      type: "list",
      name: "deployTarget",
      message: "Deploy target:",
      default: opts.deployTarget ?? defaults.deployTarget,
      choices: choices(DEPLOY_TARGETS),
    },
    {
      type: "confirm",
      name: "enableApi",
      message: "Enable API codegen from an OpenAPI spec?",
      default: false,
    },
    {
      type: "input",
      name: "apiSpec",
      message: "Path to OpenAPI spec:",
      default: "./openapi.yaml",
      when: (a: Record<string, unknown>) => a.enableApi === true,
    },
  ]);

  return answers as Answers;
}

interface Answers {
  name: string;
  backend: string;
  frontend: string;
  database: string;
  deployTarget: string;
  enableApi?: boolean;
  apiSpec?: string;
}

function buildYaml(answers: Answers): string {
  const lines = [
    "# Blissful Infra Configuration",
    `name: ${answers.name}`,
    `backend: ${answers.backend}`,
    ...(answers.frontend !== "none" ? [`frontend: ${answers.frontend}`] : []),
    ...(answers.database !== "none" ? [`database: ${answers.database}`] : []),
    "deploy:",
    `  target: ${answers.deployTarget}`,
    "monitoring: default",
  ];

  if (answers.enableApi) {
    lines.push(
      "api:",
      `  spec: ${answers.apiSpec ?? "./openapi.yaml"}`,
      "  generate:",
      "    client:",
      "      language: typescript",
      "      output: ./frontend/src/api",
    );
    if (answers.backend !== "none") {
      lines.push(
        "    server:",
        `      framework: ${answers.backend}`,
        "      output: ./backend/src/generated",
      );
    }
  }

  return lines.join("\n") + "\n";
}

export const initCommand = new Command("init")
  .description("Create a blissful-infra.yaml config file in the current directory")
  .option("-y, --yes", "accept all defaults without prompting")
  .option("--name <name>", "project name")
  .option("--backend <backend>", "backend framework (spring-boot | fastapi | express | go-chi)")
  .option("--frontend <frontend>", "frontend framework (react-vite | nextjs | none)")
  .option("--database <database>", "database (postgres | redis | postgres-redis | none)")
  .option("--deploy-target <target>", "deploy target (local-only | cloudflare | vercel | aws)")
  .action(async (opts: InitOptions) => {
    const cwd = process.cwd();
    const dest = path.join(cwd, "blissful-infra.yaml");

    // Warn if config already exists
    try {
      await fs.access(dest);
      const { overwrite } = opts.yes
        ? { overwrite: true }
        : await inquirer.prompt([{
            type: "confirm",
            name: "overwrite",
            message: chalk.yellow("blissful-infra.yaml already exists. Overwrite?"),
            default: false,
          }]);
      if (!overwrite) {
        console.log(chalk.dim("Aborted."));
        return;
      }
    } catch {
      // File doesn't exist — proceed
    }

    const answers = await gatherOptions(cwd, opts);
    const yaml = buildYaml(answers);

    await fs.writeFile(dest, yaml, "utf8");

    console.log();
    console.log(chalk.green("✓ Created blissful-infra.yaml"));
    console.log();
    console.log(chalk.dim("Next steps:"));
    console.log(chalk.cyan("  blissful-infra up") + chalk.dim("          scaffold + start containers"));
    if (answers.enableApi) {
      console.log(chalk.cyan("  blissful-infra generate") + chalk.dim("    generate API client and server stubs"));
    }
    console.log(chalk.cyan("  blissful-infra dashboard") + chalk.dim("   open the dashboard"));
  });
