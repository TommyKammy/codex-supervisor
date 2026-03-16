const DETERMINISTIC_CHANGE_CLASSES = [
  "backend",
  "docs",
  "infrastructure",
  "schema",
  "tests",
  "workflow",
] as const;

export type DeterministicChangeClass = (typeof DETERMINISTIC_CHANGE_CLASSES)[number];

export interface ClassifiedChangedFile {
  path: string;
  changeClass: DeterministicChangeClass;
}

interface ChangeClassRule {
  changeClass: DeterministicChangeClass;
  matches: (normalizedPath: string) => boolean;
}

function normalizeChangedFilePath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

const CHANGE_CLASS_RULES: ChangeClassRule[] = [
  {
    changeClass: "workflow",
    matches: (filePath) => /^\.github\/workflows\/.+/i.test(filePath),
  },
  {
    changeClass: "docs",
    matches: (filePath) =>
      /^docs\/.+/i.test(filePath) ||
      /^readme(?:\.[^.]+)?\.md$/i.test(filePath) ||
      /\.(?:md|mdx|rst|adoc|txt)$/i.test(filePath),
  },
  {
    changeClass: "tests",
    matches: (filePath) =>
      /(?:^|\/)(?:test|tests|__tests__)\/.+/i.test(filePath) ||
      /\.(?:test|spec)\.[^/]+$/i.test(filePath),
  },
  {
    changeClass: "schema",
    matches: (filePath) =>
      /(?:^|\/)(?:db|database|prisma|schema|schemas|migrations?)\/.+/i.test(filePath) ||
      /(?:^|\/)schema\.(?:prisma|sql|json|ya?ml)$/i.test(filePath),
  },
  {
    changeClass: "infrastructure",
    matches: (filePath) =>
      /(?:^|\/)(?:infra|infrastructure|terraform|helm|k8s|kubernetes|deploy|deployment|ops|docker)\/.+/i.test(
        filePath,
      ) ||
      /(?:^|\/)Dockerfile$/i.test(filePath) ||
      /(?:^|\/)docker-compose\.[^/]+$/i.test(filePath) ||
      /\.(?:tf|tfvars|hcl)$/i.test(filePath),
  },
];

export function classifyChangedFile(filePath: string): DeterministicChangeClass {
  const normalizedPath = normalizeChangedFilePath(filePath);
  for (const rule of CHANGE_CLASS_RULES) {
    if (rule.matches(normalizedPath)) {
      return rule.changeClass;
    }
  }

  return "backend";
}

export function classifyChangedFiles(filePaths: string[]): ClassifiedChangedFile[] {
  return filePaths
    .map((filePath) => normalizeChangedFilePath(filePath))
    .filter((filePath) => filePath.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      path: filePath,
      changeClass: classifyChangedFile(filePath),
    }));
}

export function detectDeterministicChangeClasses(filePaths: string[]): DeterministicChangeClass[] {
  return [...new Set(classifyChangedFiles(filePaths).map((entry) => entry.changeClass))].sort();
}
