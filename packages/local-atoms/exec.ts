/**
 * Atom 2: `atom.exec` — Allowlisted, shell-free template command runner (K7).
 *
 * Security Rules (Design Doc §5.6):
 * - Executes ONLY from two allowed sources:
 *   1. Built-in third-party templates (`BUILTIN_TEMPLATE_MAP`: codex / claude).
 *   2. First-party component templates in verified `SignedConfigPayload.firstPartyCommands`,
 *      ONLY when the component was installed via `atom.installComponent` and its publisher
 *      is in `BUILTIN_PUBLISHERS`.
 * - Every placeholder is strictly validated via `validateTypedPlaceholderValue`
 *   (enforcing built-in domain scope for URLs and rejecting shell injection).
 * - Executes via `execFile(resolvedBinary, argv, { shell: false })` — NEVER invokes a shell.
 * - For `codex.mcp.add_remote` and `claude.mcp.add_remote`, checks existing MCP config first
 *   and returns `CONFLICT` with `existingUrl` when `conflictPolicy !== 'replace'`.
 * - Templates requiring `stdinSecret: true` cannot be invoked directly via `atom.exec.run`;
 *   secrets are piped strictly via `stdin` through `atom.credential.inject`.
 */

import { execFile } from 'node:child_process';
import os from 'node:os';
import {
  BUILTIN_TEMPLATE_MAP,
  DEFAULT_MCP_SERVER_NAME,
  isBuiltinPublisherId,
  validateFirstPartyCommandArgvBounds,
  validateTypedPlaceholderValue,
  type TemplatePlaceholderType,
} from '../../shared/desktop-builtin-rules.ts';
import {
  hostErr,
  hostOk,
  type AtomExecParams,
  type AtomExecResult,
  type ConfirmationFact,
  type HostInvokeResult,
  type HostReleaseChannel,
} from '../../shared/desktop-contract.ts';
import type { SignedConfigPayload } from '../../shared/signed-config.ts';
import { readMcpEntryFromFile, resolveSafeHomePath } from './config.ts';
import { assertFeatureAllowsResource, type FeatureConfirmationGate } from './confirmation.ts';
import type { ComponentInstallRegistry } from './install-component.ts';
import type { PathResolver } from './path-resolver.ts';
import type { SerialMutationQueue } from './serial-queue.ts';

const DEFAULT_EXEC_TIMEOUT_MS = 20_000;
const MAX_CAPTURE_CHARS = 64 * 1024;
const PLACEHOLDER_TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

export type CommandRunnerInput = {
  binaryPath: string;
  argv: readonly string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
};

export type CommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type CommandRunner = (input: CommandRunnerInput) => Promise<CommandRunnerOutput>;

export type ExecPreviewResult = {
  templateId: string;
  source: 'builtin-third-party' | 'signed-first-party';
  program: string;
  argv: string[];
  mutating: boolean;
  facts: ConfirmationFact[];
};

export type ExecAtomDeps = {
  homeDir?: string;
  channel?: HostReleaseChannel;
  allowLocalDevLoopback?: boolean;
  getSignedConfig: () => SignedConfigPayload;
  pathResolver: PathResolver;
  componentRegistry: ComponentInstallRegistry;
  confirmationGate: FeatureConfirmationGate;
  mutationQueue: SerialMutationQueue;
  commandRunner?: CommandRunner;
  timeoutMs?: number;
  /** Optional publisher allowlist validator override (defaults to `isBuiltinPublisherId`). */
  isAllowedPublisherId?: (publisherId: string) => boolean;
};

type ResolvedTemplate = {
  source: 'builtin-third-party' | 'signed-first-party';
  templateId: string;
  program: string;
  componentId?: string;
  mutating: boolean;
  stdinSecret: boolean;
  argvTemplate: readonly string[];
  paramSchemas: Record<string, { type: TemplatePlaceholderType; required?: boolean; defaultValue?: string }>;
};

function truncateOutput(text: string): string {
  if (text.length <= MAX_CAPTURE_CHARS) return text;
  return `${text.slice(0, MAX_CAPTURE_CHARS)}\n…[truncated]`;
}

export const defaultCommandRunner: CommandRunner = input => {
  return new Promise(resolve => {
    let settled = false;
    const finish = (output: CommandRunnerOutput) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: output.exitCode,
        stdout: truncateOutput(output.stdout),
        stderr: truncateOutput(output.stderr),
        timedOut: output.timedOut,
      });
    };

    const child = execFile(
      input.binaryPath,
      [...input.argv],
      {
        encoding: 'utf8',
        shell: false,
        timeout: input.timeoutMs,
        maxBuffer: 1024 * 1024,
        env: input.env,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : '';
        const err = typeof stderr === 'string' ? stderr : '';
        if (!error) {
          finish({ exitCode: 0, stdout: out, stderr: err, timedOut: false });
          return;
        }
        const execError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: unknown };
        const timedOut = Boolean(execError.killed && (execError.signal === 'SIGTERM' || execError.signal === 'SIGKILL'));
        const exitCode = typeof execError.code === 'number' ? execError.code : 1;
        finish({
          exitCode,
          stdout: out,
          stderr: err || error.message,
          timedOut,
        });
      },
    );

    if (input.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        // Ignore EPIPE if process exits early before reading stdin.
      });
      child.stdin.end(input.stdin, 'utf8');
    }
  });
};

type McpConfigTarget = {
  filePath: string;
  fileFormat: 'json' | 'toml';
  sectionPath: string;
};

function resolveBuiltinMcpConfigTarget(
  templateId: string,
  signedConfig: SignedConfigPayload,
  homeDir: string,
): McpConfigTarget | null {
  const isCodex = templateId.startsWith('codex.mcp.');
  const isClaude = templateId.startsWith('claude.mcp.');
  if (!isCodex && !isClaude) return null;

  const agentId = isCodex ? 'codex' : 'claude';
  const agentRule = signedConfig.agents?.[agentId];
  const configRule = agentRule?.configRuleId ? signedConfig.configRules?.[agentRule.configRuleId] : undefined;

  if (configRule) {
    const safePath = resolveSafeHomePath(homeDir, configRule.homeRelativePath);
    if (safePath.ok) {
      return {
        filePath: safePath.resolvedPath,
        fileFormat: configRule.fileFormat,
        sectionPath: configRule.sectionPath,
      };
    }
  }

  const fallbackRel = isCodex ? '.codex/config.toml' : '.claude.json';
  const safeFallback = resolveSafeHomePath(homeDir, fallbackRel);
  if (!safeFallback.ok) return null;
  return {
    filePath: safeFallback.resolvedPath,
    fileFormat: isCodex ? 'toml' : 'json',
    sectionPath: isCodex ? 'mcp_servers' : 'mcpServers',
  };
}

export class ExecAtom {
  private readonly homeDir: string;
  private readonly channel: HostReleaseChannel;
  private readonly allowLocalDevLoopback: boolean;
  private readonly getSignedConfig: () => SignedConfigPayload;
  private readonly pathResolver: PathResolver;
  private readonly componentRegistry: ComponentInstallRegistry;
  private readonly confirmationGate: FeatureConfirmationGate;
  private readonly mutationQueue: SerialMutationQueue;
  private readonly commandRunner: CommandRunner;
  private readonly timeoutMs: number;
  private readonly isAllowedPublisherId: (publisherId: string) => boolean;

  constructor(deps: ExecAtomDeps) {
    this.homeDir = deps.homeDir ?? os.homedir();
    this.channel = deps.channel ?? 'stable';
    this.allowLocalDevLoopback = deps.allowLocalDevLoopback ?? false;
    this.getSignedConfig = deps.getSignedConfig;
    this.pathResolver = deps.pathResolver;
    this.componentRegistry = deps.componentRegistry;
    this.confirmationGate = deps.confirmationGate;
    this.mutationQueue = deps.mutationQueue;
    this.commandRunner = deps.commandRunner ?? defaultCommandRunner;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    this.isAllowedPublisherId = deps.isAllowedPublisherId ?? isBuiltinPublisherId;
  }

  /**
   * Computes shell-trusted confirmation facts and rendered argv WITHOUT executing.
   */
  preview(params: AtomExecParams): HostInvokeResult<ExecPreviewResult> {
    const prepared = this.prepareTemplateCall(params, { allowStdinSecret: false });
    if (!prepared.ok) return prepared;
    const { template, argv, facts } = prepared.data;
    return hostOk({
      templateId: template.templateId,
      source: template.source,
      program: template.program,
      argv,
      mutating: template.mutating,
      facts,
    });
  }

  /**
   * Executes an allowlisted built-in or installed first-party command template.
   */
  async run(params: AtomExecParams): Promise<HostInvokeResult<AtomExecResult>> {
    const prepared = this.prepareTemplateCall(params, { allowStdinSecret: false });
    if (!prepared.ok) return prepared;

    const { signedConfig, template, argv, validatedArgs, facts, conflictPolicy } = prepared.data;

    if (template.mutating) {
      const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
        kind: 'commandTemplate',
        id: template.templateId,
      });
      if (!authCheck.ok) return authCheck;
    }

    // Pre-check MCP conflicts before prompting the user.
    const preConflict = this.checkMcpConflict(template.templateId, validatedArgs, conflictPolicy, signedConfig);
    if (!preConflict.ok) return preConflict;

    if (template.mutating) {
      const approval = await this.confirmationGate.ensureApproved({
        featureId: params.featureId,
        signedConfig,
        facts,
      });
      if (!approval.ok) return approval;
    }

    const execute = async (): Promise<HostInvokeResult<AtomExecResult>> => {
      // Re-check inside serial queue to prevent TOCTOU races.
      const queueConflict = this.checkMcpConflict(template.templateId, validatedArgs, conflictPolicy, signedConfig);
      if (!queueConflict.ok) return queueConflict;

      return this.executePrepared(template, argv, undefined);
    };

    if (template.mutating) {
      return this.mutationQueue.enqueue(execute, `atom.exec:${template.templateId}`);
    }
    return execute();
  }

  /**
   * Internal helper used exclusively by `atom.credential.inject` to pipe a secret
   * strictly over stdin to a verified, host-installed first-party component.
   * Secrets are NEVER placed in argv and are scrubbed from captured output.
   */
  async runFirstPartyWithStdinSecret(params: {
    featureId: string;
    templateId: string;
    expectedComponentId: string;
    args?: Record<string, string | boolean>;
    secret: string;
    extraFacts?: readonly ConfirmationFact[];
  }): Promise<HostInvokeResult<AtomExecResult>> {
    const prepared = this.prepareTemplateCall(
      {
        featureId: params.featureId,
        templateId: params.templateId,
        args: params.args,
      },
      { allowStdinSecret: true },
    );
    if (!prepared.ok) return prepared;

    const { signedConfig, template, argv, facts } = prepared.data;
    if (template.source !== 'signed-first-party' || !template.stdinSecret) {
      return hostErr('POLICY_DENIED', `Template "${template.templateId}" is not an allowlisted stdin-secret template`, {
        templateId: template.templateId,
      });
    }
    if (template.componentId !== params.expectedComponentId) {
      return hostErr(
        'POLICY_DENIED',
        `Template "${template.templateId}" targets component "${template.componentId}", expected "${params.expectedComponentId}"`,
        {
          templateId: template.templateId,
          templateComponentId: template.componentId,
          expectedComponentId: params.expectedComponentId,
        },
      );
    }

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'commandTemplate',
      id: template.templateId,
    });
    if (!authCheck.ok) return authCheck;

    const allFacts = [...facts, ...(params.extraFacts ?? [])];
    const approval = await this.confirmationGate.ensureApproved({
      featureId: params.featureId,
      signedConfig,
      facts: allFacts,
    });
    if (!approval.ok) return approval;

    return this.mutationQueue.enqueue(
      () => this.executePrepared(template, argv, params.secret),
      `atom.exec.stdinSecret:${template.templateId}`,
    );
  }

  private prepareTemplateCall(
    params: AtomExecParams,
    options: { allowStdinSecret: boolean },
  ): HostInvokeResult<{
    signedConfig: SignedConfigPayload;
    template: ResolvedTemplate;
    argv: string[];
    validatedArgs: Record<string, string>;
    facts: ConfirmationFact[];
    conflictPolicy: 'abort' | 'replace';
  }> {
    if (!params || typeof params !== 'object') {
      return hostErr('INVALID_PARAMS', 'exec params are required');
    }
    if (!params.templateId || typeof params.templateId !== 'string') {
      return hostErr('INVALID_PARAMS', 'templateId is required');
    }

    const conflictPolicy = params.conflictPolicy ?? 'abort';
    if (conflictPolicy !== 'abort' && conflictPolicy !== 'replace') {
      return hostErr('INVALID_PARAMS', `Invalid conflictPolicy: "${String(conflictPolicy)}"`);
    }

    const signedConfig = this.getSignedConfig();
    const templateResult = this.resolveTemplate(params.templateId, signedConfig);
    if (!templateResult.ok) return templateResult;
    const template = templateResult.data;

    if (template.stdinSecret && !options.allowStdinSecret) {
      return hostErr(
        'POLICY_DENIED',
        `Template "${template.templateId}" requires stdin secret delivery via atom.credential`,
        { templateId: template.templateId },
      );
    }

    const rawArgs = params.args ?? {};
    if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      return hostErr('INVALID_PARAMS', 'args must be a key-value object');
    }

    // Reject unknown argument keys not declared in template schema.
    for (const key of Object.keys(rawArgs)) {
      if (!(key in template.paramSchemas)) {
        return hostErr('INVALID_PARAMS', `Unexpected argument "${key}" for template "${template.templateId}"`, {
          templateId: template.templateId,
          arg: key,
        });
      }
    }

    const validatedArgs: Record<string, string> = {};
    const domainOpts = {
      channel: this.channel,
      allowLocalDevLoopback: this.allowLocalDevLoopback,
    };

    for (const [paramName, schema] of Object.entries(template.paramSchemas)) {
      const provided = rawArgs[paramName];
      const rawValue = provided !== undefined ? provided : schema.defaultValue;
      if (rawValue === undefined) {
        if (schema.required) {
          return hostErr('INVALID_PARAMS', `Missing required argument "${paramName}" for template "${template.templateId}"`, {
            templateId: template.templateId,
            arg: paramName,
          });
        }
        continue;
      }

      const check = validateTypedPlaceholderValue(schema.type, rawValue, domainOpts);
      if (!check.ok) {
        const code = schema.type === 'url_in_domain_scope' ? 'POLICY_DENIED' : 'INVALID_PARAMS';
        return hostErr(code, check.reason, {
          templateId: template.templateId,
          arg: paramName,
          type: schema.type,
        });
      }
      validatedArgs[paramName] = check.value;
    }

    // Render argv tokens without ever concatenating into a shell command string.
    const renderedArgv: string[] = [];
    for (const token of template.argvTemplate) {
      for (const match of token.matchAll(PLACEHOLDER_TOKEN_RE)) {
        const placeholderName = match[1]!;
        if (!(placeholderName in validatedArgs)) {
          return hostErr(
            'INVALID_PARAMS',
            `Unresolved placeholder "{${placeholderName}}" in template "${template.templateId}"`,
            { templateId: template.templateId, placeholder: placeholderName },
          );
        }
      }
      const rendered = token.replace(PLACEHOLDER_TOKEN_RE, (_full, name: string) => validatedArgs[name]!);
      if (/\{[^}]*\}/.test(rendered)) {
        return hostErr('POLICY_DENIED', `Malformed placeholder token in template "${template.templateId}"`, {
          templateId: template.templateId,
        });
      }
      renderedArgv.push(rendered);
    }

    if (template.source === 'signed-first-party' && template.componentId) {
      const renderedBounds = validateFirstPartyCommandArgvBounds(template.componentId, renderedArgv);
      if (!renderedBounds.ok) {
        return hostErr('POLICY_DENIED', renderedBounds.reason, {
          templateId: template.templateId,
          componentId: template.componentId,
        });
      }
    }

    const facts = this.buildFacts(template, renderedArgv, validatedArgs, signedConfig);
    return hostOk({
      signedConfig,
      template,
      argv: renderedArgv,
      validatedArgs,
      facts,
      conflictPolicy,
    });
  }

  private resolveTemplate(templateId: string, signedConfig: SignedConfigPayload): HostInvokeResult<ResolvedTemplate> {
    const builtin = BUILTIN_TEMPLATE_MAP.get(templateId);
    if (builtin) {
      return hostOk({
        source: 'builtin-third-party',
        templateId: builtin.templateId,
        program: builtin.program,
        mutating: builtin.mutating,
        stdinSecret: false,
        argvTemplate: builtin.argv,
        paramSchemas: builtin.params,
      });
    }

    const firstParty = signedConfig.firstPartyCommands?.[templateId];
    if (!firstParty) {
      return hostErr('POLICY_DENIED', `Template "${templateId}" is not in built-in or signed first-party allowlist`, {
        templateId,
      });
    }

    const componentManifest = signedConfig.components?.[firstParty.componentId];
    if (!componentManifest) {
      return hostErr(
        'POLICY_DENIED',
        `First-party template "${templateId}" references unknown component "${firstParty.componentId}"`,
        { templateId, componentId: firstParty.componentId },
      );
    }

    const installed = this.componentRegistry.getInstalled(firstParty.componentId);
    if (!installed) {
      return hostErr(
        'NOT_FOUND',
        `First-party component "${firstParty.componentId}" must be installed via atom.installComponent before running "${templateId}"`,
        { templateId, componentId: firstParty.componentId },
      );
    }

    if (!this.isAllowedPublisherId(installed.publisherId)) {
      return hostErr(
        'POLICY_DENIED',
        `Installed component "${firstParty.componentId}" publisher "${installed.publisherId}" is not allowlisted`,
        { templateId, componentId: firstParty.componentId, publisherId: installed.publisherId },
      );
    }

    const argvBounds = validateFirstPartyCommandArgvBounds(firstParty.componentId, firstParty.argv);
    if (!argvBounds.ok) {
      return hostErr('POLICY_DENIED', argvBounds.reason, {
        templateId,
        componentId: firstParty.componentId,
      });
    }

    return hostOk({
      source: 'signed-first-party',
      templateId: firstParty.templateId,
      program: firstParty.componentId,
      componentId: firstParty.componentId,
      mutating: firstParty.mutating,
      stdinSecret: Boolean(firstParty.stdinSecret),
      argvTemplate: firstParty.argv,
      paramSchemas: firstParty.params ?? {},
    });
  }

  private checkMcpConflict(
    templateId: string,
    validatedArgs: Record<string, string>,
    conflictPolicy: 'abort' | 'replace',
    signedConfig: SignedConfigPayload,
  ): HostInvokeResult<true> {
    if (templateId !== 'codex.mcp.add_remote' && templateId !== 'claude.mcp.add_remote') {
      return hostOk(true);
    }
    if (conflictPolicy === 'replace') {
      return hostOk(true);
    }

    const target = resolveBuiltinMcpConfigTarget(templateId, signedConfig, this.homeDir);
    if (!target) return hostOk(true);

    const serverName = validatedArgs.serverName ?? DEFAULT_MCP_SERVER_NAME;
    const requestedUrl = validatedArgs.mcpUrl;
    if (!requestedUrl) return hostOk(true);

    const readResult = readMcpEntryFromFile({
      filePath: target.filePath,
      fileFormat: target.fileFormat,
      sectionPath: target.sectionPath,
      serverName,
    });
    if (!readResult.ok || !readResult.exists || !readResult.entry?.url) {
      return hostOk(true);
    }

    if (readResult.entry.url !== requestedUrl) {
      return hostErr(
        'CONFLICT',
        `MCP server "${serverName}" is already configured with a different URL (${readResult.entry.url})`,
        {
          templateId,
          serverName,
          configPath: target.filePath,
          existingUrl: readResult.entry.url,
          requestedUrl,
        },
      );
    }

    return hostOk(true);
  }

  private buildFacts(
    template: ResolvedTemplate,
    renderedArgv: readonly string[],
    validatedArgs: Record<string, string>,
    signedConfig: SignedConfigPayload,
  ): ConfirmationFact[] {
    const facts: ConfirmationFact[] = [
      {
        kind: 'exec_program',
        label: `Run ${template.program} (${template.templateId})`,
        value: `${template.program} ${renderedArgv.join(' ')}`.trim(),
      },
    ];

    for (const [paramName, schema] of Object.entries(template.paramSchemas)) {
      if (schema.type === 'url_in_domain_scope' && validatedArgs[paramName]) {
        facts.push({
          kind: 'connect_url',
          label: `Connect endpoint (${paramName})`,
          value: validatedArgs[paramName]!,
        });
      }
    }

    const mcpTarget = resolveBuiltinMcpConfigTarget(template.templateId, signedConfig, this.homeDir);
    if (mcpTarget) {
      facts.push({
        kind: 'modify_file',
        label: `Modify ${template.program} MCP config`,
        value: mcpTarget.filePath,
      });
    }

    return facts;
  }

  private async executePrepared(
    template: ResolvedTemplate,
    argv: readonly string[],
    stdinSecret: string | undefined,
  ): Promise<HostInvokeResult<AtomExecResult>> {
    let binaryPath: string | null = null;

    if (template.source === 'signed-first-party' && template.componentId) {
      const installed = this.componentRegistry.getInstalled(template.componentId);
      if (!installed) {
        return hostErr('NOT_FOUND', `Installed component "${template.componentId}" is no longer available`, {
          templateId: template.templateId,
          componentId: template.componentId,
        });
      }
      binaryPath = installed.executablePath;
    } else {
      binaryPath = await this.pathResolver.resolveBinary(template.program);
      if (!binaryPath) {
        return hostErr('NOT_FOUND', `Executable "${template.program}" not found in PATH`, {
          templateId: template.templateId,
          program: template.program,
        });
      }
    }

    const mergedPath = await this.pathResolver.getExecutablePath();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: mergedPath,
    };

    const startTime = Date.now();
    const output = await this.commandRunner({
      binaryPath,
      argv,
      timeoutMs: this.timeoutMs,
      env,
      stdin: stdinSecret,
    });
    const durationMs = Date.now() - startTime;

    // Never allow an injected secret to echo back in stdout or stderr.
    const scrub = (text: string): string => {
      if (!stdinSecret || !text) return text;
      return text.split(stdinSecret).join('[REDACTED]');
    };

    const stdout = scrub(output.stdout);
    const stderr = scrub(output.stderr);

    if (output.timedOut) {
      return hostErr('TIMEOUT', `Command "${template.templateId}" timed out after ${this.timeoutMs}ms`, {
        templateId: template.templateId,
        program: template.program,
        durationMs,
      });
    }

    if (output.exitCode !== 0) {
      return hostErr('EXEC_FAILED', `Command "${template.templateId}" exited with code ${output.exitCode}`, {
        templateId: template.templateId,
        program: template.program,
        exitCode: output.exitCode,
        stdout,
        stderr,
        durationMs,
      });
    }

    return hostOk({
      templateId: template.templateId,
      program: template.program,
      exitCode: output.exitCode,
      stdout,
      stderr,
      durationMs,
    });
  }
}

export function createExecAtom(deps: ExecAtomDeps): ExecAtom {
  return new ExecAtom(deps);
}
