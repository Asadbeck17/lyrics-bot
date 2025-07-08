// src/localizations/localization.js
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

const localesPath = path.join(__dirname, '..', 'locales');
const loadedTranslations = {};

const availableLanguages = fs.readdirSync(localesPath)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));

availableLanguages.forEach(lang => {
    try {
        const filePath = path.join(localesPath, `${lang}.json`);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        loadedTranslations[lang] = JSON.parse(fileContent);
    } catch (error) {
        console.error(`Lokalizatsiya faylini yuklashda xato (${lang}.json):`, error);
    }
});

async function getTranslation(chatId, key, params = {}) {
    let userLang = 'uz';
    try {
        const user = await db.getUser(chatId);
        if (user && user.language && availableLanguages.includes(user.language)) {
            userLang = user.language;
        }
    } catch (error) {
        console.error("Tarjima uchun foydalanuvchi tilini olishda xato:", error);
    }
    
    const translationSet = loadedTranslations[userLang] || loadedTranslations['uz'] || {};
    let messageTemplate = translationSet[key] || (loadedTranslations['uz'] ? loadedTranslations['uz'][key] : '') || `Missing translation for key: ${key} in lang: ${userLang}`;

    if (typeof messageTemplate === 'string') {
        for (const placeholder in params) {
            messageTemplate = messageTemplate.replace(new RegExp(`{${placeholder}}`, 'g'), params[placeholder]);
        }
    }
    return messageTemplate;
}

function getLanguageSelectionMessage() {
    let message = "";
    availableLanguages.forEach(lang => {
        if (loadedTranslations[lang] && loadedTranslations[lang].welcome_new) {
            message += loadedTranslations[lang].welcome_new + "\n";
        }
    });
    return message.trim() || "Please select your language / Iltimos, tilni tanlang / Пожалуйста, выберите язык";
}

module.exports = {
    t: getTranslation,
    getLanguageSelectionMessage,
    availableLanguages,
    loadedTranslations
};