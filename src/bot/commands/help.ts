import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List all available bot commands and what they do');

const COMMANDS = [
  {
    name: '/status',
    desc: 'Show bot health: market regimes, pending signals, open positions, daily P&L, strategy weights, and settings.',
  },
  {
    name: '/scan',
    desc: 'Immediately trigger a market scan. Useful when you want to force-check for new setups without waiting for the next scheduled cycle.',
  },
  {
    name: '/positions',
    desc: 'List all confirmed active positions with entry price, current SL/TP, leverage, and time open.',
  },
  {
    name: '/close <id> <price>',
    desc: 'Record that you manually exited a position. Supply the position ID (first 8 chars from /positions) and your actual exit price. Calculates R-multiple P&L.',
  },
  {
    name: '/history [count]',
    desc: 'Show the last N closed trades (default 5, max 20). Displays asset, direction, strategy, R-multiple, exit reason, and date.',
  },
  {
    name: '/performance [period]',
    desc: 'Full performance stats: win rate, profit factor, avg score, per-strategy and per-trade-type breakdown. Periods: today / week / all.',
  },
  {
    name: '/toggle <on|off>',
    desc: 'Enable or disable signal scanning. When disabled, no new signals are posted until you re-enable.',
  },
  {
    name: '/report <daily|weekly>',
    desc: 'Generate an AI-powered performance summary for today or the past 7 days (requires ANTHROPIC_API_KEY).',
  },
  {
    name: '/config',
    desc: 'Display current bot configuration: scan interval, max positions, daily loss limit, score threshold, leverage caps, and assets monitored.',
  },
  {
    name: '/check <symbol>',
    desc: 'Immediately analyze any symbol (e.g. SOL, DOGE, BTC/USDT). Shows all 4 strategy results including below-threshold setups — no score filter applied.',
  },
  {
    name: '/watchlist',
    desc: 'Snapshot scan of BTC, ETH, SOL, XRP, PEPE. Shows only signals above the score threshold with score, leverage, and % deployment.',
  },
  {
    name: '/live <start|stop>',
    desc: 'Start an auto-updating watchlist dashboard for BTC/ETH/SOL/XRP/PEPE that refreshes every 5 minutes. Only one dashboard active at a time.',
  },
  {
    name: '/help',
    desc: 'Show this message.',
  },
];

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x00ff87)
    .setTitle('📖 Bot Command Reference')
    .setDescription('All available slash commands:')
    .addFields(
      COMMANDS.map((c) => ({
        name: c.name,
        value: c.desc,
        inline: false,
      }))
    )
    .setFooter({ text: 'Tip: Set DISCORD_GUILD_ID in your env for instant command updates.' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
