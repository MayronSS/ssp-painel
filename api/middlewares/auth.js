function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.status(401).json({
        success: false,
        message: 'Acesso negado: você não está autenticado.'
    });
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.isAdmin) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Acesso negado: permissões administrativas necessárias.'
    });
}

module.exports = {
    requireAuth,
    requireAdmin
};
