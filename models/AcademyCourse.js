const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: true,
    enum: ['basico', 'intermediario', 'avancado', 'especializacao', 'reciclagem'],
    default: 'basico'
  },
  icon: {
    type: String,
    default: 'fa-graduation-cap'
  },
  tone: {
    type: String,
    default: 'brand',
    enum: ['brand', 'emerald', 'amber', 'rose', 'indigo', 'violet']
  },
  modules: [{
    title: { type: String, required: true },
    content: { type: String, default: '' },
    videoUrl: { type: String, default: '' },
    duration: { type: Number, default: 0 }, // minutes
    order: { type: Number, default: 0 }
  }],
  prerequisites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademyCourse'
  }],
  requiredRole: {
    type: String,
    default: '' // Discord role ID required to access
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    required: true
  }
}, { timestamps: true });

courseSchema.index({ category: 1, isActive: 1 });

module.exports = mongoose.models.AcademyCourse || mongoose.model('AcademyCourse', courseSchema);
