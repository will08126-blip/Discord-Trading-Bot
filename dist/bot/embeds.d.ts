import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { StrategySignal, ActivePosition, ClosedTrade } from '../types';
import type { SingleAssetScanResult } from '../engine';
export declare function buildSignalEmbed(signal: StrategySignal): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildPositionEmbed(position: ActivePosition, currentPrice?: number): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildExitAlertEmbed(position: ActivePosition, type: 'TP_APPROACH' | 'TP_HIT', currentPrice: number, newTP?: number): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildTPUpdateEmbed(position: ActivePosition, oldTP: number, newTP: number, currentPrice: number): {
    embeds: EmbedBuilder[];
};
export declare function buildCheckSummaryEmbed(result: SingleAssetScanResult): EmbedBuilder;
export declare function buildWatchlistEmbed(results: SingleAssetScanResult[], isLive?: boolean): {
    embeds: EmbedBuilder[];
};
export declare function buildEarlyProfitAlertEmbed(position: ActivePosition, currentPrice: number, returnOnCapital: number): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
};
export declare function buildClosedTradeEmbed(trade: ClosedTrade): {
    embeds: EmbedBuilder[];
};
//# sourceMappingURL=embeds.d.ts.map