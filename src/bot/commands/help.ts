import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to use this bot — getting started guide and command reference');

const LINE = '━━━━━━━━━━━━━━━━━━━━━━━';

const COMMAND_SECTIONS = [
  {
    title: '📈 Active Trading',
    commands: [
      {
        name: '/positions',
        desc: 'See all open trades with entry, stop loss, take profit, and leverage. Each position has a 🔴 **Close** button — click it to close the trade instantly.',
      },
      {
        name: '/close <price> [id]',
        desc: 'Fallback command if buttons are unavailable. Provide the exit price; leave the ID blank if only one trade is open. Use the 🔴 **Close Position** button on any tracking message for the easiest experience.',
      },
      {
        name: '/trade-status [id]',
        desc: 'Live letter grade (S / A+ / A / B / C / D / F) for your open trade(s) based on R-multiple, progress to TP, RSI momentum, and time in trade. Omit the ID to grade all open positions.',
      },
      {
        name: '/pulse',
        desc: 'Force an immediate health check on all open positions right now — no need to wait for the automatic 15-minute cycle. Resets the health-check timer.',
      },
    ],
  },
  {
    title: '🔍 Market Analysis',
    commands: [
      {
        name: '/scan',
        desc: 'Force a market scan right now instead of waiting for the next scheduled cycle.',
      },
      {
        name: '/check <symbol>',
        desc: 'Deep analysis of any symbol (e.g. BTC, SOL, DOGE). Shows all 4 strategy results including setups below the score threshold.',
      },
      {
        name: '/live <start|stop>',
        desc: 'Auto-updating watchlist for BTC, ETH, SOL, XRP, PEPE — refreshes every 5 minutes. Only one dashboard active at a time. Use `/live stop` to dismiss it.',
      },
    ],
  },
  {
    title: '📊 Performance & Stats',
    commands: [
      {
        name: '/status',
        desc: 'Bot health dashboard: market regimes, pending signals, open positions, daily P&L, and strategy weights.',
      },
      {
        name: '/history [count]',
        desc: 'Last N closed trades (default 5, max 20) with asset, direction, strategy, R-multiple P&L, and exit reason.',
      },
      {
        name: '/performance [period]',
        desc: 'Full stats: win rate, profit factor, avg score, per-strategy breakdown. Periods: today / week / all.',
      },
      {
        name: '/report <daily|weekly>',
        desc: 'AI-powered performance summary for today or the past 7 days (requires ANTHROPIC_API_KEY).',
      },
    ],
  },
  {
    title: '⚙️ Settings',
    commands: [
      {
        name: '/toggle <on|off>',
        desc: 'Enable or disable signal scanning. When off, no new signals are posted until you re-enable.',
      },
      {
        name: '/filter <strict|normal|relaxed>',
        desc: 'Adjust the signal quality threshold. **strict** = score ≥ 75 (ELITE only, fewest signals). **normal** = score ≥ 60 (default). **relaxed** = score ≥ 45 (most signals, lower conviction).',
      },
      {
        name: '/weights <view|reset|set>',
        desc: 'Manage per-strategy signal weights. **view** — see current weights. **reset** — restore recommended defaults. **set strategy:<name> value:<0.5–1.0>** — manually pin a strategy weight.',
      },
      {
        name: '/config',
        desc: 'View current bot config: scan interval, max positions, daily loss limit, score threshold, leverage caps, and monitored assets.',
      },
    ],
  },
];

export async function execute(interaction: ChatInputCommandInteraction) {
  const gettingStarted = new EmbedBuilder()
    .setColor(0x00ff87)
    .setTitle('🚀 Getting Started — How It Works')
    .setDescription('This bot scans crypto markets and posts trade setups for you. Here\'s the full flow:')
    .addFields({
      name: LINE,
      value: [
        '**1️⃣  Bot scans** BTC, ETH, SOL, XRP, PEPE every 5 minutes',
        '**2️⃣  Signal posted** — shows entry zone, stop loss, take profit, and recommended leverage',
        '**3️⃣  You enter** — if you take the trade on your exchange, click ✅ **Entered** and the bot starts tracking it',
        '**4️⃣  Bot monitors** — updates trailing stop loss and alerts you if price approaches SL or TP',
        '**5️⃣  You exit** — when you close the trade, click 🔴 **Close Position** on the tracking message',
        '**6️⃣  Bot records** — fetches the current price automatically (you can adjust if needed), calculates P&L, and updates your stats',
      ].join('\n'),
      inline: false,
    })
    .addFields({
      name: '💡 Tips',
      value: [
        '• **R-multiples** = how many times your risk you made/lost (e.g. +2R means you made 2× your stop distance)',
        '• **Trailing SL** = stop loss that moves up as price moves in your favour',
        '• Signals expire after 2 hours if not confirmed',
        '• Use `/status` to see if the bot is active and what the current market regime is',
      ].join('\n'),
      inline: false,
    })
    .setFooter({ text: 'Use /help to see this guide anytime' });

  const commandRef = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📖 Command Reference');

  for (const section of COMMAND_SECTIONS) {
    commandRef.addFields({
      name: section.title,
      value: section.commands.map((c) => `**${c.name}**\n${c.desc}`).join('\n\n'),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [gettingStarted, commandRef], ephemeral: true });
}
