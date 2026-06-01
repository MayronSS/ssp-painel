const https = require('https');
const querystring = require('querystring');
const { discordAPIRequest } = require('./discord');

function getDiscordAuthorizeUrl() {
    const clientId = process.env.CLIENT_ID;
    const redirectUri = `${process.env.DASHBOARD_URL}/api/auth/discord/callback`;
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
}

function exchangeCode(code) {
    return new Promise((resolve, reject) => {
        const clientId = process.env.CLIENT_ID;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        const redirectUri = `${process.env.DASHBOARD_URL}/api/auth/discord/callback`;

        const body = querystring.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
        });

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: '/api/v10/oauth2/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(json);
                    } else {
                        reject(new Error(json.error_description || json.error || `HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function getUserProfile(accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'discord.com',
            port: 443,
            path: '/api/v10/users/@me',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(json);
                    } else {
                        reject(new Error(json.message || `HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function checkUserGuildMember(userId) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        throw new Error("GUILD_ID não configurado no .env");
    }
    return discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
}

module.exports = {
    getDiscordAuthorizeUrl,
    exchangeCode,
    getUserProfile,
    checkUserGuildMember
};
