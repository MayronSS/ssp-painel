const mongoose = require('mongoose');

const guildConfigSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  channels: {
    ticketsPanel: { type: String, default: '' },
    ticketsCategory: { type: String, default: '' },
    corregedoriaCategory: { type: String, default: '' },
    editalPanel: { type: String, default: '' },
    editalAvaliacao: { type: String, default: '' },
    editalResultados: { type: String, default: '' },
    editalAvaliacaoPmesp: { type: String, default: '' },
    editalAvaliacaoPcesp: { type: String, default: '' },
    editalResultadosPmesp: { type: String, default: '' },
    editalResultadosPcesp: { type: String, default: '' },
    pontoPanel: { type: String, default: '' },
    pontoLogs: { type: String, default: '' },
    copomLogs: { type: String, default: '' },
    adminLogs: { type: String, default: '' },
    memberLogs: { type: String, default: '' },
    corregedoriaResults: { type: String, default: '' },
    disciplinaryWarnings: { type: String, default: '' },
    ausenciaPanel: { type: String, default: '' },
    ausenciaLogs: { type: String, default: '' },
    warningPanel: { type: String, default: '' },
    avaliacaoPanel: { type: String, default: '' },
    avaliacaoLogs: { type: String, default: '' },
    academiaPanel: { type: String, default: '' },
    academiaAvisos: { type: String, default: '' },
    pontoLogsPmesp: { type: String, default: '' },
    pontoLogsPcesp: { type: String, default: '' },
    ausenciaLogsPmesp: { type: String, default: '' },
    ausenciaLogsPcesp: { type: String, default: '' },
    memberLogsEntrada: { type: String, default: '' },
    memberLogsSaida: { type: String, default: '' },
    exoneracoes: { type: String, default: '' },
    transferencias: { type: String, default: '' },
    solicitacoesInternas: { type: String, default: '' },
    blacklist: { type: String, default: '' },
    sugestoes: { type: String, default: '' },
    hierarchy: { type: String, default: '' }
  },
  roles: {
    lspdGeral: { type: String, default: '' },
    comandoAdmin: { type: String, default: '' },
    ticketStaff: { type: String, default: '' },
    policial: { type: String, default: '' },
    setupAuthorized: { type: String, default: '' },
    recrutaCadete: { type: String, default: '' },
    advVerbal: { type: String, default: '' },
    adv1: { type: String, default: '' },
    adv2: { type: String, default: '' },
    adv3: { type: String, default: '' },
    administrativo: { type: String, default: '' },
    ministrador: { type: String, default: '' },
    cidadao: { type: String, default: '' },
    preAprovado: { type: String, default: '' },
    caboRole: { type: String, default: '' }
  },
  modules: {
    tickets: { type: Boolean, default: true },
    ponto: { type: Boolean, default: true },
    edital: { type: Boolean, default: true },
    ausencia: { type: Boolean, default: true },
    warning: { type: Boolean, default: true },
    avaliacao: { type: Boolean, default: true }
  },
  embeds: {
    design: {
      colors: {
        primary: { type: String, default: '' },
        success: { type: String, default: '' },
        danger: { type: String, default: '' },
        warning: { type: String, default: '' },
        dark: { type: String, default: '' }
      },
      logo: { type: String, default: '' }
    },
    tickets: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    },
    ponto: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    },
    edital: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    },
    ausencia: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    },
    warning: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    },
    avaliacao: {
      panel: {
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        banner: { type: String, default: '' }
      }
    }
  }
}, { timestamps: true });

module.exports = mongoose.models.GuildConfig || mongoose.model('GuildConfig', guildConfigSchema);
