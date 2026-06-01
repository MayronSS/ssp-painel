const express = require('express');
const router = express.Router();
const AcademyCourse = require('../../models/AcademyCourse');
const AcademyEnrollment = require('../../models/AcademyEnrollment');
const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog } = require('../utils/helpers');

// ==========================================
// COURSES — CRUD
// ==========================================

// List all active courses (with enrollment counts)
router.get('/academy/courses', async (req, res) => {
    try {
        const { category } = req.query;
        const query = { isActive: true };
        if (category) query.category = category;

        const courses = await AcademyCourse.find(query).sort({ category: 1, createdAt: -1 }).lean();

        // Get enrollment counts per course
        const courseIds = courses.map(c => c._id);
        const enrollmentCounts = await AcademyEnrollment.aggregate([
            { $match: { courseId: { $in: courseIds } } },
            { $group: { _id: '$courseId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }
        ]);

        const countsMap = {};
        enrollmentCounts.forEach(e => { countsMap[e._id.toString()] = { total: e.total, completed: e.completed }; });

        const enriched = courses.map(c => ({
            ...c,
            enrollments: countsMap[c._id.toString()]?.total || 0,
            completions: countsMap[c._id.toString()]?.completed || 0,
            totalModules: c.modules?.length || 0
        }));

        res.json({ success: true, courses: enriched });
    } catch (error) {
        console.error('Erro ao listar cursos:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar cursos.' });
    }
});

// Get single course details
router.get('/academy/courses/:id', async (req, res) => {
    try {
        const course = await AcademyCourse.findById(req.params.id).lean();
        if (!course) return res.status(404).json({ success: false, message: 'Curso não encontrado.' });

        // Get user enrollment if exists
        const enrollment = await AcademyEnrollment.findOne({
            userId: req.session.user.id,
            courseId: req.params.id
        }).lean();

        res.json({ success: true, course, enrollment });
    } catch (error) {
        console.error('Erro ao buscar curso:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar curso.' });
    }
});

// Create course (Admin only)
router.post('/academy/courses', requireAdmin, async (req, res) => {
    try {
        const { title, description, category, icon, tone, modules, requiredRole } = req.body;
        if (!title || !category) {
            return res.status(400).json({ success: false, message: 'Título e categoria são obrigatórios.' });
        }

        const course = await AcademyCourse.create({
            title, description, category,
            icon: icon || 'fa-graduation-cap',
            tone: tone || 'brand',
            modules: modules || [],
            requiredRole: requiredRole || '',
            createdBy: req.session.user.id
        });

        await registrarAuditLog(
            'academia_curso_criado',
            'Curso Criado',
            `${req.session.user.displayName} criou o curso "${title}".`,
            req.session.user.id,
            req.session.user.username,
            { courseId: course._id.toString(), title, category }
        );

        res.json({ success: true, message: 'Curso criado com sucesso!', course });
    } catch (error) {
        console.error('Erro ao criar curso:', error);
        res.status(500).json({ success: false, message: 'Erro ao criar curso.' });
    }
});

// Update course (Admin only)
router.put('/academy/courses/:id', requireAdmin, async (req, res) => {
    try {
        const course = await AcademyCourse.findByIdAndUpdate(
            req.params.id,
            req.body,
            { returnDocument: 'after' }
        );
        if (!course) return res.status(404).json({ success: false, message: 'Curso não encontrado.' });
        res.json({ success: true, message: 'Curso atualizado!', course });
    } catch (error) {
        console.error('Erro ao atualizar curso:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar curso.' });
    }
});

// Delete (soft) course (Admin only)
router.delete('/academy/courses/:id', requireAdmin, async (req, res) => {
    try {
        await AcademyCourse.findByIdAndUpdate(req.params.id, { isActive: false });
        res.json({ success: true, message: 'Curso desativado.' });
    } catch (error) {
        console.error('Erro ao desativar curso:', error);
        res.status(500).json({ success: false, message: 'Erro ao desativar curso.' });
    }
});

// ==========================================
// ENROLLMENTS — User progress
// ==========================================

// Enroll in a course
router.post('/academy/enroll/:courseId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { courseId } = req.params;

        const course = await AcademyCourse.findById(courseId);
        if (!course || !course.isActive) {
            return res.status(404).json({ success: false, message: 'Curso não encontrado ou inativo.' });
        }

        // Check if already enrolled
        const existing = await AcademyEnrollment.findOne({ userId, courseId });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Você já está matriculado neste curso.' });
        }

        const enrollment = await AcademyEnrollment.create({
            userId,
            courseId,
            status: 'enrolled',
            startedAt: new Date()
        });

        res.json({ success: true, message: 'Matrícula realizada com sucesso!', enrollment });
    } catch (error) {
        console.error('Erro ao matricular:', error);
        res.status(500).json({ success: false, message: 'Erro ao realizar matrícula.' });
    }
});

// Complete a module
router.put('/academy/enroll/:courseId/complete-module/:moduleIndex', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { courseId, moduleIndex } = req.params;
        const idx = parseInt(moduleIndex);

        const enrollment = await AcademyEnrollment.findOne({ userId, courseId });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: 'Matrícula não encontrada.' });
        }

        const course = await AcademyCourse.findById(courseId);
        if (!course) return res.status(404).json({ success: false, message: 'Curso não encontrado.' });

        // Check if already completed
        const alreadyDone = enrollment.completedModules.some(m => m.moduleIndex === idx);
        if (!alreadyDone) {
            enrollment.completedModules.push({ moduleIndex: idx, completedAt: new Date() });
        }

        // Calculate progress
        const totalModules = course.modules?.length || 1;
        const completed = enrollment.completedModules.length;
        enrollment.progress = Math.round((completed / totalModules) * 100);
        enrollment.status = 'in_progress';

        // Check if course is complete
        if (enrollment.progress >= 100) {
            enrollment.status = 'completed';
            enrollment.completedAt = new Date();
            enrollment.progress = 100;
        }

        await enrollment.save();

        res.json({
            success: true,
            message: enrollment.status === 'completed' ? 'Curso concluído! Parabéns!' : 'Módulo concluído!',
            enrollment
        });
    } catch (error) {
        console.error('Erro ao completar módulo:', error);
        res.status(500).json({ success: false, message: 'Erro ao registrar progresso.' });
    }
});

// Get user's enrollments
router.get('/academy/my-enrollments', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const enrollments = await AcademyEnrollment.find({ userId }).populate('courseId').lean();
        res.json({ success: true, enrollments });
    } catch (error) {
        console.error('Erro ao buscar matrículas:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar matrículas.' });
    }
});

// Admin: Get all enrollments for a course
router.get('/academy/courses/:id/enrollments', requireAdmin, async (req, res) => {
    try {
        const enrollments = await AcademyEnrollment.find({ courseId: req.params.id }).lean();
        res.json({ success: true, enrollments });
    } catch (error) {
        console.error('Erro ao buscar matrículas do curso:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar matrículas.' });
    }
});

// Academy dashboard stats
router.get('/academy/stats', async (req, res) => {
    try {
        const [totalCourses, totalEnrollments, completions] = await Promise.all([
            AcademyCourse.countDocuments({ isActive: true }),
            AcademyEnrollment.countDocuments({}),
            AcademyEnrollment.countDocuments({ status: 'completed' })
        ]);

        // Category distribution
        const categoryDist = await AcademyCourse.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            stats: {
                totalCourses,
                totalEnrollments,
                completions,
                completionRate: totalEnrollments > 0 ? Math.round((completions / totalEnrollments) * 100) : 0,
                categoryDistribution: Object.fromEntries(categoryDist.map(c => [c._id, c.count]))
            }
        });
    } catch (error) {
        console.error('Erro ao buscar stats da academia:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas.' });
    }
});

module.exports = router;
