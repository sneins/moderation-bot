// moderation-bot/index.js
const { Client, GatewayIntentBits, SlashCommandBuilder, Collection, REST, Routes, PermissionsBitField } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers
] });

const punishmentsChannelId = process.env.LOG_CHANNEL_ID;
const warningLimit = 4;

const warnings = new Map();
const blacklist = new Set();
const bans = new Map();
const mutes = new Map();
const savedRoles = new Map();

const commands = [
  new SlashCommandBuilder().setName('ban').setDescription('Забанить участника')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('причина').setDescription('Причина').setRequired(true))
    .addIntegerOption(opt => opt.setName('время').setDescription('Время в минутах').setRequired(true)),

  new SlashCommandBuilder().setName('unban').setDescription('Разбанить участника')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true)),

  new SlashCommandBuilder().setName('mute').setDescription('Замьютить участника')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('причина').setDescription('Причина').setRequired(true))
    .addIntegerOption(opt => opt.setName('время').setDescription('Время в минутах').setRequired(true)),

  new SlashCommandBuilder().setName('unmute').setDescription('Размьютить участника')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true)),

  new SlashCommandBuilder().setName('blist').setDescription('Добавить в чёрный список')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('причина').setDescription('Причина').setRequired(true)),

  new SlashCommandBuilder().setName('unblist').setDescription('Убрать из чёрного списка')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true)),

  new SlashCommandBuilder().setName('clearblist').setDescription('Очистить чёрный список'),

  new SlashCommandBuilder().setName('showblist').setDescription('Показать чёрный список'),

  new SlashCommandBuilder().setName('pred').setDescription('Выдать предупреждение')
    .addUserOption(opt => opt.setName('ник').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('причина').setDescription('Причина').setRequired(true)),

  new SlashCommandBuilder().setName('help').setDescription('Показать список команд')
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ У тебя нет прав администратора для использования этой команды.', ephemeral: true });
    }

    const target = interaction.options.getUser('ник');
    const reason = interaction.options.getString('причина');
    const duration = interaction.options.getInteger('время');
    const member = interaction.guild.members.cache.get(target?.id);
    const logChannel = interaction.guild.channels.cache.get(punishmentsChannelId);

    const log = async (message) => {
      if (logChannel) await logChannel.send(message);
    };

    switch (interaction.commandName) {
      case 'ban': {
        savedRoles.set(target.id, member.roles.cache.map(r => r.id));
        await member.roles.set([]);
        bans.set(target.id, Date.now() + duration * 60000);
        await interaction.reply({ content: `Пользователь ${target.tag} забанен.`, ephemeral: true });
        await log(`🔨 Бан: ${target.tag} | Причина: ${reason} | Время: ${duration} мин.`);
        break;
      }

      case 'unban': {
        bans.delete(target.id);
        if (savedRoles.has(target.id)) {
          const roles = savedRoles.get(target.id).filter(id => interaction.guild.roles.cache.has(id));
          await member.roles.set(roles);
          savedRoles.delete(target.id);
        }
        await interaction.reply({ content: `Пользователь ${target.tag} разбанен.`, ephemeral: true });
        await log(`✅ Разбан: ${target.tag}`);
        break;
      }

      case 'mute': {
        let muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
        if (!muteRole) muteRole = await interaction.guild.roles.create({ name: 'Muted', permissions: [] });
        await member.roles.add(muteRole);
        mutes.set(target.id, Date.now() + duration * 60000);
        await interaction.reply({ content: `Пользователь ${target.tag} замьючен.`, ephemeral: true });
        await log(`🔇 Мут: ${target.tag} | Причина: ${reason} | Время: ${duration} мин.`);
        break;
      }

      case 'unmute': {
        const muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
        if (muteRole) await member.roles.remove(muteRole);
        mutes.delete(target.id);
        await interaction.reply({ content: `Пользователь ${target.tag} размьючен.`, ephemeral: true });
        await log(`✅ Размьют: ${target.tag}`);
        break;
      }

      case 'blist': {
        blacklist.add(target.id);
        await member.kick('Чёрный список');
        await interaction.reply({ content: `Пользователь ${target.tag} добавлен в чёрный список и кикнут.`, ephemeral: true });
        await log(`🚫 ЧС: ${target.tag} | Причина: ${reason}`);
        break;
      }

      case 'unblist': {
        blacklist.delete(target.id);
        await interaction.reply({ content: `Пользователь ${target.tag} удалён из чёрного списка.`, ephemeral: true });
        await log(`✅ Удалён из ЧС: ${target.tag}`);
        break;
      }

      case 'clearblist': {
        blacklist.clear();
        await interaction.reply({ content: 'Чёрный список очищен.', ephemeral: true });
        await log(`♻️ ЧС очищен.`);
        break;
      }

      case 'showblist': {
        const list = Array.from(blacklist).map(id => `<@${id}>`).join(', ') || 'Пусто';
        await interaction.reply({ content: `Чёрный список: ${list}`, ephemeral: true });
        break;
      }

      case 'pred': {
        const count = (warnings.get(target.id) || 0) + 1;
        warnings.set(target.id, count);
        await interaction.reply({ content: `Выдано предупреждение ${target.tag} (${count}/4).`, ephemeral: true });
        await log(`⚠️ Предупреждение: ${target.tag} | Причина: ${reason} (${count}/4)`);

        if (count === 3) {
          let muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole) muteRole = await interaction.guild.roles.create({ name: 'Muted', permissions: [] });
          await member.roles.add(muteRole);
          mutes.set(target.id, Date.now() + 60 * 60000);
          await log(`🔇 Авто-мут за 3 предупреждения: ${target.tag} (60 мин)`);
        }

        if (count >= 4) {
          savedRoles.set(target.id, member.roles.cache.map(r => r.id));
          await member.roles.set([]);
          bans.set(target.id, Date.now() + 60 * 60000);
          warnings.set(target.id, 0);
          await log(`🔨 Авто-бан за 4 предупреждения: ${target.tag} (60 мин)`);
        }
        break;
      }

      case 'help': {
        await interaction.reply({
          ephemeral: true,
          content:
`**📘 Список команд:**
/ban [ник] [причина] [время в мин] — Забанить
/unban [ник] — Разбанить
/mute [ник] [причина] [время в мин] — Замьютить
/unmute [ник] — Размьютить
/blist [ник] [причина] — Добавить в ЧС и кикнуть
/unblist [ник] — Удалить из ЧС
/clearblist — Очистить ЧС
/showblist — Показать ЧС
/pred [ник] [причина] — Выдать предупреждение
/help — Показать этот список`
        });
        break;
      }
    }
  } catch (err) {
    console.error('Ошибка выполнения команды:', err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ Произошла ошибка.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Произошла ошибка.', ephemeral: true });
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (blacklist.has(message.author.id)) {
    await message.member.kick('Пользователь в черном списке');
    return;
  }

  if (bans.has(message.author.id)) {
    const remaining = bans.get(message.author.id) - Date.now();
    if (remaining > 0) {
      await message.delete();
      return message.author.send(`⛔ Вы забанены до ${new Date(Date.now() + remaining).toLocaleTimeString()}`).catch(() => {});
    } else {
      bans.delete(message.author.id);
    }
  }

  if (mutes.has(message.author.id)) {
    const remaining = mutes.get(message.author.id) - Date.now();
    if (remaining > 0) {
      await message.delete();
      return message.author.send(`🔇 Вы замьючены до ${new Date(Date.now() + remaining).toLocaleTimeString()}`).catch(() => {});
    } else {
      mutes.delete(message.author.id);
    }
  }
});

client.login(process.env.TOKEN);
