const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademyCourse',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['enrolled', 'in_progress', 'completed', 'failed'],
    default: 'enrolled'
  },
  progress: {
    type: Number,
    default: 0, // percentage 0-100
    min: 0,
    max: 100
  },
  completedModules: [{
    moduleIndex: Number,
    completedAt: { type: Date, default: Date.now }
  }],
  startedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  grade: {
    type: Number,
    default: null
  }
}, { timestamps: true });

enrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });
enrollmentSchema.index({ courseId: 1, status: 1 });

module.exports = mongoose.models.AcademyEnrollment || mongoose.model('AcademyEnrollment', enrollmentSchema);
