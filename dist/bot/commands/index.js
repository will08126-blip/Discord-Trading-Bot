"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.commands = void 0;
exports.deployCommands = deployCommands;
const discord_js_1 = require("discord.js");
const config_1 = require("../../config");
const logger_1 = require("../../utils/logger");
const statusCmd = __importStar(require("./status"));
const positionsCmd = __importStar(require("./positions"));
const closeCmd = __importStar(require("./close"));
const performanceCmd = __importStar(require("./performance"));
const toggleCmd = __importStar(require("./toggle"));
const reportCmd = __importStar(require("./report"));
const scanCmd = __importStar(require("./scan"));
const historyCmd = __importStar(require("./history"));
const helpCmd = __importStar(require("./help"));
const configCmd = __importStar(require("./config"));
const checkCmd = __importStar(require("./check"));
const watchlistCmd = __importStar(require("./watchlist"));
const liveCmd = __importStar(require("./live"));
const tradeStatusCmd = __importStar(require("./tradeStatus"));
exports.commands = new Map([
    ['status', statusCmd],
    ['positions', positionsCmd],
    ['close', closeCmd],
    ['performance', performanceCmd],
    ['toggle', toggleCmd],
    ['report', reportCmd],
    ['scan', scanCmd],
    ['history', historyCmd],
    ['help', helpCmd],
    ['config', configCmd],
    ['check', checkCmd],
    ['watchlist', watchlistCmd],
    ['live', liveCmd],
    ['trade-status', tradeStatusCmd],
]);
/** Deploy (register) all slash commands with Discord's API */
async function deployCommands(guildId) {
    const rest = new discord_js_1.REST().setToken(config_1.config.discord.token);
    const commandBodies = [...exports.commands.values()].map((c) => c.data.toJSON());
    try {
        if (guildId) {
            // Guild-scoped (instant update, good for testing)
            await rest.put(discord_js_1.Routes.applicationGuildCommands(config_1.config.discord.clientId, guildId), { body: commandBodies });
            logger_1.logger.info(`Deployed ${commandBodies.length} guild commands to guild ${guildId}`);
        }
        else {
            // Global commands (up to 1h propagation delay)
            await rest.put(discord_js_1.Routes.applicationCommands(config_1.config.discord.clientId), { body: commandBodies });
            logger_1.logger.info(`Deployed ${commandBodies.length} global commands`);
        }
    }
    catch (err) {
        logger_1.logger.error('Failed to deploy commands:', err);
    }
}
//# sourceMappingURL=index.js.map