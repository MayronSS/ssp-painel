const express = require('express');
const router = express.Router();
const AuditLog = require('../../models/AuditLog');

// Listar logs de auditoria (enhanced)
router.get('/logs', async (req, res) => {
    try {
        const { type, q, page = 1, limit = 20, startDate, endDate, userId } = req.query;
        let query = {};
        if (type) query.type = type;
        if (userId) query.userId = userId;
        if (q) {
            query.$or = [
                { type: { $regex: q, $options: 'i' } },
                { title: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
        }

        const parsedPage = parseInt(page);
        const parsedLimit = Math.min(parseInt(limit) || 20, 100);
        const skip = (parsedPage - 1) * parsedLimit;

        const [logs, total] = await Promise.all([
            AuditLog.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parsedLimit)
                .lean(),
            AuditLog.countDocuments(query)
        ]);

        res.json({
            success: true,
            logs,
            total,
            pages: Math.ceil(total / parsedLimit),
            currentPage: parsedPage
        });
    } catch (error) {
        console.error("Erro em /api/logs:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar logs de auditoria.' });
    }
});

// Get log statistics
router.get('/logs/stats', async (req, res) => {
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [total, todayCount, weekCount, typeDistribution, topUsers] = await Promise.all([
            AuditLog.countDocuments({}),
            AuditLog.countDocuments({ createdAt: { $gte: today } }),
            AuditLog.countDocuments({ createdAt: { $gte: weekAgo } }),
            AuditLog.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            AuditLog.aggregate([
                { $match: { createdAt: { $gte: weekAgo } } },
                { $group: { _id: '$username', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ])
        ]);

        res.json({
            success: true,
            stats: {
                total,
                todayCount,
                weekCount,
                typeDistribution: Object.fromEntries(typeDistribution.map(t => [t._id, t.count])),
                topUsers: topUsers.map(u => ({ username: u._id, count: u.count }))
            }
        });
    } catch (error) {
        console.error("Erro em /api/logs/stats:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas.' });
    }
});

// Get all distinct log types
router.get('/logs/types', async (req, res) => {
    try {
        const types = await AuditLog.distinct('type');
        res.json({ success: true, types: types.sort() });
    } catch (error) {
        console.error("Erro em /api/logs/types:", error);
        res.status(500).json({ success: false, types: [] });
    }
});

module.exports = router;
