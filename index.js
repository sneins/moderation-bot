// moderation-bot/index.js
const { Client, GatewayIntentBits, SlashCommandBuilder, Collection, REST, Routes, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers
] });

const punishmentsChannelId = process.env.LOG_CHANNEL_ID;
const warningLimit = 4;

const warnings = new Map();    // userId => count предупреждений
const blacklist = new Set();   // userId в черном списке
const bans = new Map();        // userId => timestamp окончания бана
const mutes = new Map();       // userId => timestamp окончания мута
const savedRoles = new Map();  // userId => [roleId]

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
    .addStringOption(opt => opt.setName('причина').setDescription('Причина').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
});

// Функция логирования в канал
async function log(guild, message) {
  const logChannel = guild.channels.cache.get(punishmentsChannelId);
  if (logChannel) await logChannel.send(message);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: '❌ У тебя нет прав администратора для использования этой команды.', ephemeral: true });
  }

  const command = interaction.commandName;
  const targetUser = interaction.options.getUser('ник');
  const reason = interaction.options.getString('причина');
  const duration = interaction.options.getInteger('время');
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'Ошибка: команда работает только на сервере.', ephemeral: true });
  const member = guild.members.cache.get(targetUser?.id);

  try {
    switch (command) {
      case 'ban': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        savedRoles.set(targetUser.id, member.roles.cache.map(r => r.id));
        await member.roles.set([]);
        bans.set(targetUser.id, Date.now() + duration * 60000);
        await interaction.reply({ content: `Пользователь ${targetUser.tag} забанен на ${duration} минут.`, ephemeral: true });
        await log(guild, `🔨 Бан: ${targetUser.tag} | Причина: ${reason} | Время: ${duration} мин.`);
        break;
      }

      case 'unban': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        bans.delete(targetUser.id);
        if (savedRoles.has(targetUser.id)) {
          const roles = savedRoles.get(targetUser.id).filter(id => guild.roles.cache.has(id));
          await member.roles.set(roles);
          savedRoles.delete(targetUser.id);
        }
        await interaction.reply({ content: `Пользователь ${targetUser.tag} разбанен.`, ephemeral: true });
        await log(guild, `✅ Разбан: ${targetUser.tag}`);
        break;
      }

      case 'mute': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
        if (!muteRole) {
          muteRole = await guild.roles.create({ name: 'Muted', permissions: [] });
          // Можно дополнительно убрать права писать во всех каналах, если нужно
        }
        await member.roles.add(muteRole);
        mutes.set(targetUser.id, Date.now() + duration * 60000);
        await interaction.reply({ content: `Пользователь ${targetUser.tag} замьючен на ${duration} минут.`, ephemeral: true });
        await log(guild, `🔇 Мут: ${targetUser.tag} | Причина: ${reason} | Время: ${duration} мин.`);
        break;
      }

      case 'unmute': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        const muteRole = guild.roles.cache.find(r => r.name === 'Muted');
        if (muteRole) await member.roles.remove(muteRole);
        mutes.delete(targetUser.id);
        await interaction.reply({ content: `Пользователь ${targetUser.tag} размьючен.`, ephemeral: true });
        await log(guild, `✅ Размьют: ${targetUser.tag}`);
        break;
      }

      case 'blist': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        blacklist.add(targetUser.id);
        await interaction.reply({ content: `Пользователь ${targetUser.tag} добавлен в чёрный список и кикнут с сервера.`, ephemeral: true });
        await log(guild, `🚫 ЧС: ${targetUser.tag} | Причина: ${reason}`);

        try {
          await member.kick('Добавлен в чёрный список');
        } catch (err) {
          console.error('Ошибка при кике пользователя из черного списка:', err);
        }
        break;
      }

      case 'unblist': {
        blacklist.delete(targetUser.id);
        await interaction.reply({ content: `Пользователь ${targetUser.tag} удалён из чёрного списка.`, ephemeral: true });
        await log(guild, `✅ Удалён из ЧС: ${targetUser.tag}`);
        break;
      }

      case 'clearblist': {
        blacklist.clear();
        await interaction.reply({ content: 'Чёрный список очищен.', ephemeral: true });
        await log(guild, `♻️ ЧС очищен.`);
        break;
      }

      case 'showblist': {
        const list = Array.from(blacklist).map(id => `<@${id}>`).join(', ') || 'Пусто';
        await interaction.reply({ content: `Чёрный список: ${list}`, ephemeral: true });
        break;
      }

      case 'pred': {
        if (!member) return interaction.reply({ content: 'Пользователь не найден на сервере.', ephemeral: true });

        let count = (warnings.get(targetUser.id) || 0) + 1;
        warnings.set(targetUser.id, count);
        await interaction.reply({ content: `Выдано предупреждение ${targetUser.tag} (${count}/${warningLimit}).`, ephemeral: true });
        await log(guild, `⚠️ Предупреждение: ${targetUser.tag} | Причина: ${reason} (${count}/${warningLimit})`);

        if (count === 3) {
          let muteRole = guild.roles.cache.find(r => r.name === 'Muted');
          if (!muteRole) muteRole = await guild.roles.create({ name: 'Muted', permissions: [] });
          await member.roles.add(muteRole);
          mutes.set(targetUser.id, Date.now() + 60 * 60000);
          await log(guild, `🔇 Авто-мут за 3 предупреждения: ${targetUser.tag} (60 мин)`);
        }

        if (count >= warningLimit) {
          // Авто-бан и обнуление предупреждений
          savedRoles.set(targetUser.id, member.roles.cache.map(r => r.id));
          await member.roles.set([]);
          bans.set(targetUser.id, Date.now() + 60 * 60000);
          warnings.set(targetUser.id, 0); // сброс предупреждений после бана
          await log(guild, `🔨 Авто-бан за ${warningLimit} предупреждений: ${targetUser.tag} (60 мин)`);
        }

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

// Проверка сообщений для блокировки банов и мутов
client.on('messageCreate', async message => {
  if (message.author.bot) return;
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

// Обработка входа пользователя — кикаем, если он в черном списке
client.on('guildMemberAdd', async member => {
  if (blacklist.has(member.id)) {
    try {
      await member.send('❌ Вы в чёрном списке этого сервера, доступ запрещён.');
    } catch {}
    await member.kick('Пользователь в чёрном списке');
  }
});

client.login(process.env.TOKEN);
