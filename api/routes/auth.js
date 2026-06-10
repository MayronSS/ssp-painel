const express = require('express');
const router = express.Router();
const oauthHelper = require('../utils/oauthHelper');
const { getActiveGuildConfig } = require('../utils/discord');
const { registrarAuditLog } = require('../utils/helpers');

// Rota para iniciar o fluxo OAuth2 do Discord
router.get('/auth/discord', (req, res) => {
    try {
        const authorizeUrl = oauthHelper.getDiscordAuthorizeUrl();
        res.redirect(authorizeUrl);
    } catch (error) {
        console.error('Erro ao gerar URL do Discord:', error);
        res.status(500).json({ success: false, message: 'Erro ao iniciar autenticação.' });
    }
});

// Callback do Discord OAuth2
router.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('Código de autorização ausente.');
    }

    try {
        // 1. Trocar código pelo Token de Acesso
        const tokenData = await oauthHelper.exchangeCode(code);
        
        // 2. Buscar o Perfil do Usuário no Discord
        const profile = await oauthHelper.getUserProfile(tokenData.access_token);
        
        // 3. Buscar informações do membro no servidor LSPD
        let member;
        try {
            member = await oauthHelper.checkUserGuildMember(profile.id);
        } catch (memberErr) {
            console.error(`Usuário ${profile.id} não foi encontrado no servidor Discord:`, memberErr.message);
            return res.status(403).send('Acesso Negado: Você precisa estar no servidor Discord da SSP para acessar o painel.');
        }

        // 4. Buscar configuração do servidor
        const config = await getActiveGuildConfig();

        // Cargo OBRIGATÓRIO para acessar o painel (SSP)
        const REQUIRED_PANEL_ROLE = '1383913498571964447';

        // IDs de cargos administrativos (permissões internas do painel)
        const adminRoleIds = [
            config?.roles?.comandoAdmin,
            config?.roles?.setupAuthorized,
            config?.roles?.administrativo,
            process.env.ROLE_COMMAND,
            process.env.ROLE_SETUP,
            process.env.ROLE_ADMINISTRATIVO
        ].filter(Boolean);

        const memberRoles = member.roles || [];

        // Verificar se possui o cargo obrigatório para acessar o painel
        if (!memberRoles.includes(REQUIRED_PANEL_ROLE)) {
            return res.status(403).send('Acesso Negado: Você não possui o cargo autorizado da SSP para usar este painel.');
        }

        // Verificar se é admin (para permissões internas)
        const isAdmin = memberRoles.some(roleId => adminRoleIds.includes(roleId));

        // 5. Configurar sessão do usuário
        req.session.user = {
            id: profile.id,
            username: profile.username,
            displayName: member.nick || profile.global_name || profile.username,
            avatar: profile.avatar,
            isAdmin: isAdmin,
            email: profile.email || 'Acesso Discord'
        };

        // Registrar log de auditoria
        await registrarAuditLog(
            'login',
            'Login de Usuário',
            `${req.session.user.displayName} fez login via Discord OAuth2.`,
            req.session.user.id,
            req.session.user.username,
            { isAdmin }
        );

        // Redireciona de volta para o painel (SPA)
        res.redirect('/');
    } catch (error) {
        console.error('Erro no callback de autenticação:', error);
        res.status(500).send(`Erro na autenticação: ${error.message}`);
    }
});

// Rota de Logout
router.post('/auth/logout', async (req, res) => {
    if (req.session.user) {
        const user = req.session.user;
        await registrarAuditLog(
            'logout',
            'Logout de Usuário',
            `${user.displayName} saiu do sistema.`,
            user.id,
            user.username
        );
        
        req.session.destroy((err) => {
            if (err) {
                console.error('Erro ao destruir sessão:', err);
                return res.status(500).json({ success: false, message: 'Erro ao sair.' });
            }
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    } else {
        res.json({ success: true });
    }
});

// Retorna dados do usuário autenticado atual
router.get('/auth/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            success: true,
            user: req.session.user
        });
    } else {
        res.json({
            success: false,
            message: 'Não autenticado.'
        });
    }
});

module.exports = router;
