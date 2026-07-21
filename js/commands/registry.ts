/**
 * Named command lookup and dispatch. Definitions are data; side effects live
 * in each command's `run` (wired by the host).
 */

import { parseCommandLine } from "./parse.ts";

export type CommandResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export interface CommandInfo {
  name: string;
  usage: string;
  description: string;
}

export interface CommandRunContext {
  listCommands(): readonly CommandInfo[];
}

export interface CommandDefinition {
  name: string;
  aliases?: readonly string[];
  usage: string;
  description: string;
  run(
    args: readonly string[],
    context: CommandRunContext,
  ): CommandResult | Promise<CommandResult>;
}

export interface CommandRegistry {
  list(): readonly CommandInfo[];
  dispatch(line: string): Promise<CommandResult>;
}

export function createCommandRegistry(
  definitions: readonly CommandDefinition[],
): CommandRegistry {
  const byName = new Map<string, CommandDefinition>();

  for (const definition of definitions) {
    const keys = [definition.name, ...(definition.aliases ?? [])];
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (byName.has(normalized)) {
        throw new Error(`Duplicate command name: ${normalized}`);
      }
      byName.set(normalized, definition);
    }
  }

  const infos: CommandInfo[] = definitions.map((definition) => ({
    name: definition.name,
    usage: definition.usage,
    description: definition.description,
  }));

  const runContext: CommandRunContext = {
    listCommands: () => infos,
  };

  return {
    list: () => infos,
    async dispatch(line: string): Promise<CommandResult> {
      const parsed = parseCommandLine(line);
      if (parsed === null) {
        return { ok: false, message: "EMPTY COMMAND" };
      }

      const command = byName.get(parsed.name);
      if (command === undefined) {
        return {
          ok: false,
          message: "UNKNOWN COMMAND",
        };
      }

      return await command.run(parsed.args, runContext);
    },
  };
}
