// src/bot.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database/db');
const { t, loadedTranslations } = require('./localizations/localization'); // getLanguageSelectionMessage endi ishlatilmayapti
const geniusService = require('./services/geniusService');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const geniusApiKey = process.env.GENIUS_API_TOKEN;
const channel = process.env.CHANNEL_ID

if (!telegramToken) {
    console.error("TELEGRAM_BOT_TOKEN topilmadi! .env faylini tekshiring.");
    process.exit(1);
}
if (!geniusApiKey) {
    console.warn("GENIUS_API_TOKEN topilmadi! .env faylini tekshiring. Qo'shiq qidirish ishlamasligi mumkin.");
}

const bot = new TelegramBot(telegramToken, { polling: true });

const DEFAULT_LANGUAGE_FOR_NEW_USER = 'ru';
const ITEMS_PER_PAGE_DISPLAY = 10; 
const userSearchStates = {}; 

function escapeMarkdown(text) {
    if (typeof text !== 'string') return String(text);
    const escapeChars = /[_*[\]()~`>#+\-=|{}.!]/g; 
    return text.replace(escapeChars, '\\$&');
}

async function safeDeleteMessage(chatId, messageId) {
    if (chatId && messageId) {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (error) {
            if (!(error.response && error.response.statusCode === 400 && error.message.includes("message to delete not found"))) {
                // console.error(`[safeDeleteMessage] Xabarni o'chirishda kutilmagan xato: chatId=${chatId}, messageId=${messageId}`, error.message);
            }
        }
    }
}

async function main() {
    try {
        await db.connectDB();
        await db.initDB();
        console.log(`Bot muvaffaqiyatli ishga tushdi. Yangi foydalanuvchilar uchun standart til: ${DEFAULT_LANGUAGE_FOR_NEW_USER.toUpperCase()}`);

        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const userInfo = { first_name: msg.from.first_name, last_name: msg.from.last_name, username: msg.from.username };
        
            try {
                const user = await db.getUser(chatId);
        
                // Yangi foydalanuvchilar uchun blok
                if (!user || !user.language) {
                    await db.upsertUser(chatId, DEFAULT_LANGUAGE_FOR_NEW_USER, userInfo);
                    
                    const welcomeNewMessage = loadedTranslations[DEFAULT_LANGUAGE_FOR_NEW_USER]?.welcome_new 
                                            || loadedTranslations['uz']?.welcome_new 
                                            || "Please select your language";
        
                    // >>> DIQQAT: TUGMALAR AYNAN SHU YERDA YARATILADI <<<
                    const opts = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🇺🇿 O'zbekcha", callback_data: 'set_lang_uz' },
                                    { text: "🇷🇺 Русский", callback_data: 'set_lang_ru' },
                                    { text: "🇬🇧 English", callback_data: 'set_lang_en' }
                                ]
                            ]
                        }
                    };
                    
                    // Foydalanuvchiga tugmalar bilan birga xabar yuborish
                    await bot.sendMessage(chatId, welcomeNewMessage, opts);
        
                    // Kanalga xabarnoma yuborish (bu alohida ishlaydi)
                    try {
                        if (channel) {
                            const userFullName = (userInfo.first_name + (userInfo.last_name ? ` ${userInfo.last_name}` : '')).replace(/</g, '<').replace(/>/g, '>');
                            const userLink = `<a href="tg://user?id=${chatId}">${userFullName}</a>`;
        
                            let notificationText = `✅ <b>Yangi foydalanuvchi!</b>\n\n`
                                             + `👤 <b>Foydalanuvchi:</b> ${userLink}\n`
                                             + `🆔 <b>ID:</b> <code>${chatId}</code>\n`;
                            if (userInfo.username) {
                                notificationText += `🪪 <b>Username:</b> @${userInfo.username}`;
                            }
                            
                            await bot.sendMessage(channel, notificationText, { parse_mode: 'HTML' });
                        }
                    } catch (notifyError) {
                        console.error('[XATO] Kanalga xabar yuborishda xatolik:', notifyError.message);
                    }
        
                } else {
                    // Mavjud foydalanuvchilar uchun blok (bu yer o'zgarmagan)
                    await db.upsertUser(chatId, user.language, userInfo);
                    bot.sendMessage(chatId, await t(chatId, 'welcome_existing'));
                }
            } catch (error) {
                console.error(`[/start handler xatosi] ID ${chatId}:`, error);
            }
        });

        bot.onText(/\/language/, async (msg) => { 
            const chatId = msg.chat.id;
            console.log(`[HANDLER /language] Tilni o'zgartirish buyrug'i qabul qilindi. ChatID: ${chatId}`);
            
            const message = await t(chatId, 'language_select_prompt');
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🇺🇿 O'zbekcha", callback_data: 'set_lang_uz' },
                            { text: "🇷🇺 Русский", callback_data: 'set_lang_ru' },
                            { text: "🇬🇧 English", callback_data: 'set_lang_en' }
                        ]
                    ]
                }
            };
            bot.sendMessage(chatId, message, opts);
        });
        
        bot.on('callback_query', async (callbackQuery) => {
            const msg = callbackQuery.message;
            if (!msg) {
                return bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
            }
            const chatId = msg.chat.id;
            const data = callbackQuery.data;
            
            if (data.startsWith('set_lang_')) {
                const langCode = data.split('_')[2];
                const userInfo = { first_name: callbackQuery.from.first_name, last_name: callbackQuery.from.last_name, username: callbackQuery.from.username };
                try {
                    await db.upsertUser(chatId, langCode, userInfo);
                    const selectedMessage = await t(chatId, 'language_selected');
                    await bot.editMessageText(selectedMessage, { chat_id: chatId, message_id: msg.message_id, reply_markup: {}});
                    await bot.sendMessage(chatId, await t(chatId, 'welcome_existing'));
                } catch (e) { 
                    console.error(`Tilni saqlashda xato (callback):`, e);
                    bot.sendMessage(chatId, await t(chatId, 'error_db_save'));
                }
                return bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
            }

            const state = userSearchStates[chatId];
            if (!state) {
                await safeDeleteMessage(chatId, msg.message_id);
                return bot.answerCallbackQuery(callbackQuery.id, { text: "Bu so'rov eskirgan. Iltimos, qayta qidiring." }).catch(console.error);
            }

            if (data.startsWith('page_prev_')) {
                if (state.currentPageForAPI > 1) { 
                    state.currentPageForAPI--;
                    bot.answerCallbackQuery(callbackQuery.id, {text: `${state.currentPageForAPI}-sahifa yuklanmoqda...`}).catch(console.error);
                    const songs = await geniusService.performSearchWithPagination(state.query, geniusApiKey, state.currentPageForAPI);
                    if (songs && songs.length > 0) {
                        state.currentDisplayedSongs = songs.slice(0, ITEMS_PER_PAGE_DISPLAY); 
                        await sendSongListPage(chatId); 
                    } else {
                        state.currentPageForAPI++; 
                        bot.sendMessage(chatId, await t(chatId, 'no_more_songs')); 
                    }
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, { text: "Bu birinchi sahifa." }).catch(console.error);
                }
            } else if (data.startsWith('page_next_')) {
                const nextPageForAPI = state.currentPageForAPI + 1;
                bot.answerCallbackQuery(callbackQuery.id, {text: `${nextPageForAPI}-sahifa yuklanmoqda...`}).catch(console.error);
                const songs = await geniusService.performSearchWithPagination(state.query, geniusApiKey, nextPageForAPI);
                
                if (songs && songs.length > 0) {
                    state.currentPageForAPI = nextPageForAPI;
                    state.currentDisplayedSongs = songs.slice(0, ITEMS_PER_PAGE_DISPLAY);
                    await sendSongListPage(chatId);
                } else {
                    // Keyingi sahifada qo'shiq yo'q, currentPageForAPI ni o'zgartirmaymiz
                    bot.sendMessage(chatId, await t(chatId, 'no_more_songs'));
                }
            } else if (data === 'delete_list') {
                await safeDeleteMessage(chatId, state.messageId); 
                delete userSearchStates[chatId]; 
                bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
            } else if (data.startsWith('selectsong_')) {
                const songGeniusId = data.split('_')[1];
                const selectedSong = state.currentDisplayedSongs.find(s => String(s.id) === String(songGeniusId));

                if (selectedSong && selectedSong.url) {
                    bot.answerCallbackQuery(callbackQuery.id).catch(console.error); 
                    bot.sendChatAction(chatId, 'typing').catch(console.error);
                    const searchingText = await t(chatId, 'searching_specific_song', { songTitle: escapeMarkdown(selectedSong.title) });
                    const tempMsg = await bot.sendMessage(chatId, searchingText);

                    try {
                        const lyrics = await geniusService.findLyrics(selectedSong.url, selectedSong.full_title);
                        await safeDeleteMessage(chatId, tempMsg?.message_id); 

                        if (lyrics) {
                            const artistBlock = selectedSong.artist ? await t(chatId, 'artist_with_dash', { artist: escapeMarkdown(selectedSong.artist) }) : '';
                            let messageHeader = await t(chatId, 'lyrics_found', { title: escapeMarkdown(selectedSong.title), artist_block: artistBlock });
                            const fullLyricsText = `\n\n${lyrics}`;
                            
                            if ((messageHeader + fullLyricsText).length > 4096) {
                                messageHeader += await t(chatId, 'lyrics_too_long');
                                await bot.sendMessage(chatId, messageHeader, );
                                const LYRICS_PART_LEN = 4096 - 200;
                                for (let i = 0; i < lyrics.length; i += LYRICS_PART_LEN) {
                                    const part = lyrics.substring(i, Math.min(lyrics.length, i + LYRICS_PART_LEN));
                                    await bot.sendMessage(chatId, part);
                                }
                            } else {
                                await bot.sendMessage(chatId, messageHeader + fullLyricsText,);
                            }
                        } else {
                            bot.sendMessage(chatId, await t(chatId, 'lyrics_not_found', { query: escapeMarkdown(selectedSong.full_title) }));
                        }
                    } catch (lyricError) {
                        await safeDeleteMessage(chatId, tempMsg?.message_id);
                        console.error(`Matn topishda xato (selectsong - "${selectedSong.full_title}"):`, lyricError);
                        bot.sendMessage(chatId, await t(chatId, 'error_generic'));
                    }
                } else if (selectedSong && !selectedSong.url) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: "Xatolik: Bu qo'shiq uchun manzil topilmadi." }).catch(console.error);
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, { text: "Xatolik: Qo'shiq topilmadi." }).catch(console.error);
                }
            } else {
                 if (!callbackQuery.answered) bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
            }
        });

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const originalQuery = msg.text ? msg.text.trim() : "";
            if (!originalQuery || (originalQuery.startsWith('/') && originalQuery !== '/start') || originalQuery === '/start') return;
            
            const userInfo = {first_name: msg.from.first_name, last_name: msg.from.last_name, username: msg.from.username};
            let searchingMsg; 
            try {
                const user = await db.getUser(chatId);
                if (!user || !user.language) { 
                    const welcomeNewMessage = loadedTranslations[DEFAULT_LANGUAGE_FOR_NEW_USER]?.welcome_new || loadedTranslations['uz']?.welcome_new || "Please select language";
                    const opts = { reply_markup: { inline_keyboard: [ /* ...til tanlash tugmalari... */ ] } };
                    bot.sendMessage(chatId, welcomeNewMessage, opts);
                    return; 
                }
                await db.upsertUser(chatId, user.language, userInfo);

                searchingMsg = await bot.sendMessage(chatId, await t(chatId, 'searching_lyrics', { query: escapeMarkdown(originalQuery) }));
                bot.sendChatAction(chatId, 'typing').catch(console.error);

                const directMatchParts = originalQuery.match(/^(.+?)\s*-\s*(.+)$/);
                let directLyricsFound = false;

                if (directMatchParts && directMatchParts[1] && directMatchParts[2] && geniusApiKey) {
                    const artistName = directMatchParts[1].trim();
                    const songTitle = directMatchParts[2].trim();
                    const potentialSongs = await geniusService.initialSearchUniversal(`${artistName} - ${songTitle}`, geniusApiKey, 1); 
                    if (potentialSongs && potentialSongs.length > 0 && potentialSongs[0].url) {
                        const songToScrape = potentialSongs[0];
                        if (songToScrape.title.toLowerCase().includes(songTitle.toLowerCase()) && songToScrape.artist.toLowerCase().includes(artistName.toLowerCase())) {
                            const lyrics = await geniusService.findLyrics(songToScrape.url, songToScrape.full_title);
                            if (lyrics) { 
                                await safeDeleteMessage(chatId, searchingMsg?.message_id); searchingMsg = null; 
                                directLyricsFound = true;
                                /* ... matnni yuborish ... */ 
                            }
                        }
                    }
                }

                if (directLyricsFound) return;

                console.log(`[ChatID: ${chatId}] Dastlabki qidiruv (API sahifa 1): "${originalQuery}"`);
                const songsFromApi = await geniusService.performSearchWithPagination(originalQuery, geniusApiKey, 1);
                
                await safeDeleteMessage(chatId, searchingMsg?.message_id);
                searchingMsg = null;

                if (!songsFromApi || songsFromApi.length === 0) {
                    await bot.sendMessage(chatId, await t(chatId, 'lyrics_not_found', { query: escapeMarkdown(originalQuery) }));
                    return;
                }

                if (userSearchStates[chatId] && userSearchStates[chatId].messageId) {
                    await safeDeleteMessage(chatId, userSearchStates[chatId].messageId);
                }
                userSearchStates[chatId] = {
                    query: originalQuery, 
                    currentPageForAPI: 1, 
                    messageId: null,
                    currentDisplayedSongs: songsFromApi.slice(0, ITEMS_PER_PAGE_DISPLAY), 
                };
                
                await sendSongListPage(chatId); 

            } catch (error) {
                await safeDeleteMessage(chatId, searchingMsg?.message_id);
                console.error(`Umumiy qidiruvda xatolik ("${originalQuery}" uchun, ChatID: ${chatId}):`, error);
                bot.sendMessage(chatId, await t(chatId, 'error_generic', { query: escapeMarkdown(originalQuery) }));
            }
        });
        
        bot.on('polling_error', (error) => console.error("Polling xatosi:", error.code, error.message ? error.message.substring(0, 200) : 'No message'));
        bot.on('webhook_error', (error) => console.error("Webhook xatosi:", error.code, error.message ? error.message.substring(0, 200) : 'No message'));
        bot.on("error", (error) => console.error("Bot umumiy xatosi:", error.message ? error.message.substring(0, 200) : 'No message'));

    } catch (error) { 
        console.error("Botni ishga tushirishda asosiy xatolik:", error);
        if (db && typeof db.closeDB === 'function') {
            await db.closeDB().catch(e => console.error("MBni yopishda qo'shimcha xato:", e));
        }
        process.exit(1);
    }
}

async function sendSongListPage(chatId) { 
    const state = userSearchStates[chatId];
    if (!state || !state.currentDisplayedSongs) {
        console.warn(`[sendSongListPage] ChatID ${chatId} uchun holat yoki joriy qo'shiqlar topilmadi.`);
        return;
    }

    const songsToShow = state.currentDisplayedSongs; 
    
    if (songsToShow.length === 0 && state.currentPageForAPI === 1) { 
        await safeDeleteMessage(chatId, state.messageId); 
        bot.sendMessage(chatId, await t(chatId, 'lyrics_not_found', { query: escapeMarkdown(state.query) }));
        delete userSearchStates[chatId]; 
        return;
    }
    
    let messageText = `*${escapeMarkdown(state.query)}* - ${await t(chatId, 'artist_songs_found_title')}\n`;
    messageText += `(Sahifa ${state.currentPageForAPI})\n`; 
    messageText += `${await t(chatId, 'select_song_prompt')}\n\n`;

    const inline_keyboard = [];
    let currentRow = [];

    songsToShow.forEach((song, index) => {
        const songDisplayNumber = index + 1; 
        messageText += `${songDisplayNumber}. ${escapeMarkdown(song.full_title || song.title)}\n`;
        currentRow.push({ text: `${songDisplayNumber}`, callback_data: `selectsong_${song.id}` });
        if (currentRow.length === 5) { 
            inline_keyboard.push(currentRow);
            currentRow = [];
        }
    });
    if (currentRow.length > 0) { 
        inline_keyboard.push(currentRow);
    }

    const navigationRow = [];
    navigationRow.push({ text: "⬅️ Oldingi", callback_data: `page_prev_` }); 
    navigationRow.push({ text: "❌ O'chirish", callback_data: `delete_list` });
    navigationRow.push({ text: "Keyingi ➡️", callback_data: `page_next_` }); 
    inline_keyboard.push(navigationRow);
    
    const opts = { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard } 
    };

    try {
        if (state.messageId) {
            await bot.editMessageText(messageText, { ...opts, chat_id: chatId, message_id: state.messageId });
        } else {
            const newMessage = await bot.sendMessage(chatId, messageText, opts);
            state.messageId = newMessage.message_id;
        }
    } catch (editError) {
        if (editError.message && editError.message.includes("message is not modified")) {
            // Hech narsa qilmaymiz
        } else {
            console.error("sendSongListPage: Xabarni tahrirlash/yuborishda xato:", editError.message);
            await safeDeleteMessage(chatId, state.messageId);
            state.messageId = null; 
            try {
                const newMessage = await bot.sendMessage(chatId, messageText, opts);
                state.messageId = newMessage.message_id;
            } catch (sendNewError) {
                console.error("sendSongListPage: Yangi xabar yuborishda xato (tahrirlashdan keyin):", sendNewError.message);
            }
        }
    }
}

main();

async function gracefulShutdown(signal) {
    console.log(`\nBot to'xtatilmoqda (${signal})...`);
    try {
        if (bot && typeof bot.stopPolling === 'function' && bot.isPolling()) {
            console.log("Polling to'xtatilmoqda...");
            await bot.stopPolling({ cancel: true }); 
            console.log("Polling to'xtatildi.");
        }
        if (db && typeof db.closeDB === 'function') {
            await db.closeDB();
        }
    } catch (e) {
        console.error(`${signal}: Resurslarni tozalashda xato:`, e);
    }
    console.log(`Bot ${signal} signali bilan to'xtatildi.`);
    setTimeout(() => process.exit(0), 500); 
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));