export interface Command {
    data: {
        toJSON: () => unknown;
        name: string;
    };
    execute: (interaction: any) => Promise<void>;
}
export declare const commands: Map<string, Command>;
/** Deploy (register) all slash commands with Discord's API */
export declare function deployCommands(guildId?: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map