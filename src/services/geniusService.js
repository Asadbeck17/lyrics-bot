// src/services/geniusService.js
const axios = require('axios');
const cheerio = require('cheerio');
const he = require('he'); // HTML belgilarni dekodlash uchun

// Sodda Kirill-Lotin transliteratsiya funksiyasi
function transliterateCyrillicToLatin(text) {
    if (!text || typeof text !== 'string') return "";
    
    let latinChars = 0; let cyrillicChars = 0;
    const cyrillicRegex = /[а-яА-ЯўқғҳЎҚҒҲ]/; const latinRegex = /[a-zA-Z]/;
    for (let i = 0; i < text.length; i++) {
        if (latinRegex.test(text[i])) latinChars++;
        if (cyrillicRegex.test(text[i])) cyrillicChars++;
    }
    if (latinChars > cyrillicChars && cyrillicChars === 0) return text;

    const cyrillicToLatinMap = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'j', 'з': 'z',
        'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
        'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'x', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh',
        'щ': 'shch', 'ъ': "'", 'ы': 'i', 'ь': "", 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'ў': 'o\'', 'қ': 'q', 'ғ': 'g\'', 'ҳ': 'h',
        'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'J', 'З': 'Z',
        'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
        'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'X', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh',
        'Щ': 'Shch', 'Ъ': "'", 'Ы': 'I', 'Ь': "", 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
        'Ў': 'O\'', 'Қ': 'Q', 'Ғ': 'G\'', 'Ҳ': 'H'
    };
    
    let latinText = "";
    for (let i = 0; i < text.length; i++) {
        latinText += cyrillicToLatinMap[text[i]] || text[i];
    }
    return latinText;
}

async function findLyrics(songUrl, titleForLog = "Noma'lum qo'shiq") {
    if (!songUrl) {
        console.error(`[geniusService.findLyrics] Qo'shiq URL manzili berilmadi ("${titleForLog}" uchun).`);
        return null;
    }
    console.log(`[geniusService.findLyrics] "${titleForLog}" uchun matn Genius sahifasidan olinmoqda: ${songUrl}`);
    try {
        const { data: html } = await axios.get(songUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            },
            timeout: 15000 
        });
        const $ = cheerio.load(html);
        let lyricsText = "";
        const selectors = [
            'div[data-lyrics-container="true"]', 'div[class*="Lyrics__Container"]',
            '.lyrics p', 'div.song_body-lyrics p', 'div.lyrics'
        ];
        for (const selector of selectors) {
            let currentSelectorText = "";
            $(selector).each((i, elem) => {
                let elementHtml = $(elem).html();
                if (elementHtml) {
                    elementHtml = elementHtml.replace(/<br\s*\/?>/gi, '\n');
                    const temp$ = cheerio.load(`<div>${elementHtml}</div>`);
                    temp$('a[href*="genius.com/annotations"], button[class*="ReferentFragmentdesktop__ClickTarget"], span[class*="ReferentFragmentdesktop__Highlight"], div[class*="ReferentFragmentdesktop__HighlightText"]').remove();
                    currentSelectorText += temp$.text().trim() + '\n\n';
                } else {
                     currentSelectorText += $(elem).text().trim() + '\n\n';
                }
            });
            if (currentSelectorText.trim()) {
                lyricsText = currentSelectorText; 
                // console.log(`[geniusService.findLyrics] "${selector}" selektori orqali matn topildi.`); // Debug uchun
                break; 
            }
        }
        lyricsText = lyricsText.trim();
        if (lyricsText) {
            const patternsToRemove = [ /^\s*\d+\s*Contributors?\s*.*Lyrics\s*\n?/i, /^\s*.*?Lyrics\s*(\d+\s*Embed)?\n?/i, /^\s*Embed\s*\n?/i, /^\s*Share URL\s*\n?/i, /^\s*Copy Page URL\s*\n?/i, /^\s*Translations\s*.*?Lyrics\s*\n?/i, /^\s*\[.*?\]\s*Lyrics\s*\n?/i, /^\s*You might also like\s*\n?/i, /^\s*\d+KEmbed\s*\n?/i ];
            patternsToRemove.forEach(pattern => { 
                while(pattern.test(lyricsText)) { lyricsText = lyricsText.replace(pattern, ""); }
                lyricsText = lyricsText.replace(/^\s+/, ""); 
            });
            lyricsText = lyricsText.replace(/\[\s*(Chorus|Verse|Intro|Outro|Bridge|Pre-Chorus|Post-Chorus|Hook|Interlude|Skit|Refrain|Instrumental|Guitar Solo|Solo|Part)\s*\d*\s*:?\s*\]\s*\n?/gi, '');
            lyricsText = lyricsText.replace(/\[.*?\]\s*\n?/g, '');
            lyricsText = lyricsText.replace(/\n{3,}/g, '\n\n').trim(); 
            lyricsText = he.decode(lyricsText);
            // console.log(`[geniusService.findLyrics] Tozalangan matn ("${titleForLog}", uzunligi: ${lyricsText.length}).`); // Debug uchun
            return lyricsText;
        } else { 
            console.warn(`[geniusService.findLyrics] "${titleForLog}" uchun matn sahifadan topilmadi (${songUrl}).`);
            return null; 
        }
    } catch (error) {
        const errorMessage = error.isAxiosError && error.response 
                           ? `Axios xatosi ${error.response.status} (${songUrl})`
                           : (error.message || String(error));
        console.error(`[geniusService.findLyrics] ("${titleForLog}") xato: ${errorMessage}`);
        return null;
    }
}

async function performSearchWithPagination(searchTerm, apiKey, pageNumber = 1) {
    if (!apiKey) { 
        console.error("[geniusService.performSearchWithPagination] Genius API kaliti berilmagan.");
        return [];
    }
    const geniusApiUrl = `https://api.genius.com/search?q=${encodeURIComponent(searchTerm)}&page=${pageNumber}`;
    // console.log(`[geniusService.performSearchWithPagination] API so'rovi (sahifa ${pageNumber}): ${geniusApiUrl}`); // Debug uchun

    try {
        const response = await axios.get(geniusApiUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000 
        });

        if (response.data && response.data.response && response.data.response.hits) {
            const hits = response.data.response.hits;
            // console.log(`[geniusService.performSearchWithPagination] API DAN KELGAN XITLAR SONI ("${searchTerm}", sahifa ${pageNumber}): ${hits.length}`); // Debug uchun
            
            return hits
                .map(hit => hit.result)
                .filter(songData => 
                    songData && typeof songData.id !== 'undefined' && songData.url && 
                    songData.title && songData.primary_artist && songData.primary_artist.name
                )
                .map(songData => {
                    let originalTitle = he.decode(String(songData.title));
                    let originalArtist = he.decode(String(songData.primary_artist.name));
                    
                    // Qavs ichidagi inglizcha tarjimani va ortiqcha bo'sh joylarni olib tashlash
                    const translationRegex = /\s*\([^)]*\)\s*$/; 
                    let cleanTitle = originalTitle.replace(translationRegex, "").trim();
                    
                    // Agar tozalashdan keyin nom bo'shab qolsa yoki faqat qavs bo'lsa, asl nomni ishlatamiz
                    // Bu " (Romanized)" kabi holatlarning o'zini qoldirmaslik uchun
                    if (!cleanTitle.replace(/\s+/g, '') && originalTitle.match(translationRegex)) {
                        cleanTitle = originalTitle.trim(); // Asl nomni olamiz, ehtimol qavs nomning bir qismi edi
                    } else if (!cleanTitle) { // Agar umuman bo'shab qolsa
                        cleanTitle = originalTitle.trim();
                    }
                    
                    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
                    const cleanArtist = originalArtist.replace(/\s+/g, ' ').trim();
                    
                    const cleanFullTitle = `${cleanArtist} - ${cleanTitle}`;

                    return {
                        id: String(songData.id),
                        title: cleanTitle,
                        artist: cleanArtist,
                        full_title: cleanFullTitle,
                        url: String(songData.url) 
                    };
                });
        } else { 
            // console.log(`[geniusService.performSearchWithPagination] "${searchTerm}" (sahifa ${pageNumber}) uchun kutilgan formatda javob olinmadi.`); // Debug uchun
            return []; 
        }
    } catch (error) { 
        const errorMessage = error.isAxiosError && error.response && error.response.data && error.response.data.meta 
                           ? `${error.response.status} - ${error.response.data.meta.message}` 
                           : (error.message || String(error));
        console.error(`[geniusService.performSearchWithPagination] API so'rovida xato ("${searchTerm}", sahifa ${pageNumber}): ${errorMessage}`);
        return []; 
    }
}

async function initialSearchUniversal(query, apiKey, desiredLimit = 20) {
    if (!apiKey) { throw new Error("Genius API key is not configured."); }
    // console.log(`[geniusService.initialSearchUniversal] Dastlabki universal qidiruv: "${query}"`); // Debug uchun
    let combinedCleanedResults = [];

    const originalResults = await performSearchWithPagination(query, apiKey, 1);
    if (originalResults && originalResults.length > 0) {
        combinedCleanedResults = combinedCleanedResults.concat(originalResults);
    }

    const transliteratedQuery = transliterateCyrillicToLatin(query);
    if (query.toLowerCase() !== transliteratedQuery.toLowerCase() && transliteratedQuery.length > 0) {
        // console.log(`[geniusService.initialSearchUniversal] Transliteratsiya qilingan so'rov bilan qidirilmoqda (1-sahifa): "${transliteratedQuery}"`); // Debug uchun
        const transliteratedResults = await performSearchWithPagination(transliteratedQuery, apiKey, 1);
        if (transliteratedResults && transliteratedResults.length > 0) {
            transliteratedResults.forEach(tsong => {
                if (!combinedCleanedResults.some(osong => osong.id === tsong.id)) {
                    combinedCleanedResults.push(tsong);
                }
            });
        }
    }

    if (combinedCleanedResults.length === 0) {
        // console.log(`[geniusService.initialSearchUniversal] "${query}" uchun dastlabki natija yo'q.`); // Debug uchun
        return [];
    }
    
    const finalResults = combinedCleanedResults.slice(0, desiredLimit);
    // console.log(`[geniusService.initialSearchUniversal] Dastlabki qidiruvdan formatlangan natijalar soni ("${query}"): ${finalResults.length}`); // Debug uchun
    return finalResults;
}

module.exports = {
    findLyrics,
    initialSearchUniversal,
    performSearchWithPagination
};