// ==UserScript==
// @name         Składki klanowe - rejestr wpłat
// @namespace    margo
// @version      7.4
// @description  Spisuje wpłaty z historii klanu i porównuje z listą klanowiczów (NI)
// @match        https://*.margonem.pl/*
// @grant        none
// ==/UserScript==

(function () {
    const KEY_PAYMENTS = 'klanSkladkiLog';
    const KEY_MEMBERS = 'klanSkladkiCzlonkowie';
    const KEY_START = 'klanSkladkiStart';
    const KEY_WEBHOOK = 'klanSkladkiWebhook';
    const KEY_CLAN_WEBHOOK = 'klanSkladkiWebhookKlanowy';
    const KEY_OTHER_LOGS = 'klanSkladkiInneLogi';
    const KEY_MULTI_ACCOUNTS = 'klanSkladkiMultikonta';
    const KEY_BLACKLIST = 'klanSkladkiCzarnaLista';
    const KEY_IGNORED = 'klanSkladkiIgnorowane';
    const KEY_REQUIRED = 'klanSkladkiWymagane';
    const KEY_REQUIRED_HISTORY = 'klanSkladkiWymaganeHistoria';
    const KEY_LEVELS = 'klanSkladkiPoziomy';
    const KEY_SORT = 'klanSkladkiSortowanie';
    const KEY_THRESHOLDS = 'klanSkladkiProgi';
    const KEY_MIGRATIONS = 'klanSkladkiMigracje';
    const KEY_TREASURY = 'klanSkladkiSkarbiec';
    const DEFAULT_THRESHOLDS = '1-89 2M\n90-99 3M\n100-109 4M\n110-119 6M\n120-129 8M\n130-139 10M\n140-149 13M\n150-159 16M\n160-169 20M\n170-179 24M\n180-189 27M\n190-199 29M\n200-209 32M\n210-219 34M\n220-229 36M\n230-239 38M\n240-249 40M\n250-259 42M\n260+ 45M';
    const DEFAULT_WEBHOOK = '';
    const CLAN_WEBHOOK = '';

    const INITIAL_MEMBERS = [];

    const load = (key, def) => {
        try {
            return JSON.parse(localStorage.getItem(key)) || def;
        } catch (e) {
            return def;
        }
    };

    const save = (key, stored) => localStorage.setItem(key, JSON.stringify(stored));

    function migrate() {
        const stored = load(KEY_PAYMENTS, {});
        let changed = false;
        Object.keys(stored).forEach((id) => {
            const w = stored[id];
            if (w.dzien && w.godzina) return;
            const m = w.data && w.data.match(/^(\d{2}\.\d{2}\.\d{4}) (\d{2}:\d{2})$/);
            if (m) {
                stored[id] = { dzien: m[1], godzina: m[2], kwota: w.kwota, nick: w.nick };
            } else {
                delete stored[id];
            }
            changed = true;
        });
        if (changed) {
            save(KEY_PAYMENTS, stored);
            console.log('[Składki] Zmigrowano stare wpisy do nowego formatu');
        }
    }

    function scanHistory() {
        const rows = document.querySelectorAll('.clan-history-content .history-table tr');
        if (!rows.length) return;

        const stored = load(KEY_PAYMENTS, {});
        const logs = load(KEY_OTHER_LOGS, {});
        const start = load(KEY_START, null);
        let newCount = 0;
        let newLogs = 0;

        rows.forEach((tr) => {
            const td = tr.querySelectorAll('td');
            if (td.length < 2) return;

            const stamp = td[0].textContent.trim();
            const action = td[1].textContent.trim();
            const time = stamp.match(/^(\d{2}\.\d{2}\.\d{4}) (\d{2}:\d{2})$/);
            if (!time || !action) return;
            if (start && dateFromDay(time[1]) < dateFromDay(start)) return;

            const id = stamp + '|' + action;
            const m = action.match(/^\+(\d+)\s+złota\s+\/(.+)$/);

            if (m) {
                if (stored[id]) return;
                stored[id] = { dzien: time[1], godzina: time[2], kwota: parseInt(m[1], 10), nick: m[2].trim() };
                newCount++;
            } else {
                if (logs[id]) return;
                logs[id] = { dzien: time[1], godzina: time[2], tresc: action };
                newLogs++;
            }
        });

        if (newCount > 0) {
            save(KEY_PAYMENTS, stored);
            console.log('[Składki] Zapisano nowych wpłat: ' + newCount + ' (łącznie: ' + Object.keys(stored).length + ')');
        }
        if (newLogs > 0) {
            save(KEY_OTHER_LOGS, logs);
            console.log('[Składki] Zapisano innych zdarzeń: ' + newLogs + ' (łącznie: ' + Object.keys(logs).length + ')');
        }
    }

    function seedMembers() {
        const previous = load(KEY_MEMBERS, {});
        if (previous.zrodlo || !INITIAL_MEMBERS.length) return;
        save(KEY_MEMBERS, { nicki: INITIAL_MEMBERS, aktualizacja: new Date().toLocaleString('pl-PL'), zrodlo: 'wbudowana' });
        console.log('[Składki] Wczytano wbudowaną listę klanowiczów: ' + INITIAL_MEMBERS.length + ' osób');
    }

    function scanMembers() {
        const options = document.querySelectorAll('.clan-treasury-content .choose-player .option .text');
        if (options.length < 2) return;

        const nicks = [...options].map((o) => o.textContent.trim()).filter((n) => n.length > 1);
        if (nicks.length < 2) return;

        const previous = load(KEY_MEMBERS, { nicki: [] });
        if (JSON.stringify(previous.nicki) !== JSON.stringify(nicks)) {
            save(KEY_MEMBERS, { nicki: nicks, aktualizacja: new Date().toLocaleString('pl-PL'), zrodlo: 'skarbiec' });
            console.log('[Składki] Zaktualizowano listę klanowiczów ze skarbca: ' + nicks.length + ' osób');
        }
    }

    const MAX_LEVEL = 300;

    function clampLevel(level) {
        const m = String(level).match(/^(\d+)(.*)$/);
        if (!m) return level;
        const lvl = parseInt(m[1], 10);
        return (lvl > MAX_LEVEL ? MAX_LEVEL : lvl) + m[2];
    }

    const LEVEL_PATTERN = /\((\d+)\s*(\+)?\s*([a-ząćęłńóśźż]{0,2})\s*(?:[|\/]\s*(\d+)\s*([a-ząćęłńóśźż]{0,2}))?\s*\)/i;

    function parseLevel(text) {
        const m = String(text).match(LEVEL_PATTERN);
        if (!m) return null;
        const plus = !!m[2];
        const operational = m[4] ? parseInt(m[4], 10) : 0;
        const profession = m[5] || m[3] || '';
        if (!plus && !operational && !profession) return null;
        const lvl = operational || parseInt(m[1], 10);
        if (!(lvl > 0)) return null;
        return clampLevel(lvl + profession);
    }

    function clampLevelMap(lookup) {
        const result = {};
        Object.keys(lookup).forEach((n) => (result[n] = clampLevel(lookup[n])));
        return result;
    }

    let lastLevelReport = '';

    function scanLevels() {
        const rows = document.querySelectorAll('.clan-members-content .clan-members-table tr');
        if (!rows.length) return;

        const players = playerList().slice().sort((a, b) => b.length - a.length);
        const lookup = load(KEY_LEVELS, {});
        let changes = 0;
        const skipped = [];

        rows.forEach((tr) => {
            const text = tr.textContent.replace(/\s+/g, ' ').trim();
            const value = parseLevel(text);
            const bottom = text.toLowerCase();

            const nick = players.find((g) => bottom.indexOf(g.toLowerCase()) === 0) || players.find((g) => bottom.includes(g.toLowerCase()));

            if (!value || !nick) {
                if (text) skipped.push((!value ? 'nie odczytano poziomu' : 'nie rozpoznano nicku') + ' -> ' + JSON.stringify(text));
                return;
            }
            if (lookup[nick] !== value) {
                lookup[nick] = value;
                changes++;
            }
        });

        if (changes > 0) {
            save(KEY_LEVELS, lookup);
            console.log('[Składki] Zaktualizowano poziomy graczy: ' + changes);
        }

        const membersData = clanMembers().nicki;
        const withoutLevel = membersData.filter((n) => !lookup[n]);
        if (!withoutLevel.length && !skipped.length) return;

        const caption = rows.length + '|' + withoutLevel.join(',') + '|' + skipped.join(',');
        if (caption === lastLevelReport) return;
        lastLevelReport = caption;

        console.log('[Składki][poziomy] Wierszy w tabeli: ' + rows.length + ', klanowiczów: ' + membersData.length + ', bez poziomu: ' + withoutLevel.length + ', pominiętych wierszy: ' + skipped.length);
        if (withoutLevel.length) console.log('[Składki][poziomy] Bez poziomu: ' + withoutLevel.join(' | '));
        skipped.forEach((p) => console.log('[Składki][poziomy] POMINIĘTY: ' + p));
    }

    function sumPaymentsFrom(time) {
        let s = 0;
        Object.values(load(KEY_PAYMENTS, {})).forEach((w) => {
            if (!w.kwota) return;
            const x = w.dzien.split('.');
            const g = w.godzina.split(':');
            const t = new Date(+x[2], +x[1] - 1, +x[0], +g[0], +g[1]).getTime();
            if (t >= time - 60000) s += w.kwota;
        });
        return s;
    }

    function scanTreasury() {
        const el = document.querySelector('.clan-treasury-content .gold-info .amount');
        if (!el) return;
        const amount = parseInt(el.textContent.replace(/\D/g, ''), 10);
        if (!(amount >= 0)) return;

        const state = load(KEY_TREASURY, null);
        if (!state) {
            save(KEY_TREASURY, { kwota: amount, czas: Date.now() });
            console.log('[Składki] Kontrola skarbca: zapisano stan początkowy ' + zl(amount));
            return;
        }
        if (state.kwota === amount) {
            save(KEY_TREASURY, { kwota: amount, czas: Date.now() });
            return;
        }

        const increment = amount - state.kwota;
        const paid = sumPaymentsFrom(state.czas);
        const from = new Date(state.czas).toLocaleString('pl-PL');

        if (increment > paid) {
            const missing = increment - paid;
            console.log('[Składki] KONTROLA SKARBCA: skarbiec urósł o ' + zl(increment) + ' od ' + from + ', a zarejestrowane wpłaty to ' + zl(paid) + '. Możliwe pominięte wpłaty: ~' + zl(missing));
            alert('Kontrola skarbca!\n\nSkarbiec urósł o ' + zl(increment) + ' od ostatniej kontroli (' + from + '), a zarejestrowane wpłaty z tego okresu to ' + zl(paid) + '.\n\nMożliwe pominięte wpłaty: ~' + zl(missing) + '\n(wpisy mogły wypaść z dziennika, który mieści tylko 47 pozycji)');
        } else {
            console.log('[Składki] Kontrola skarbca OK: zmiana ' + zl(increment) + ', zarejestrowane wpłaty ' + zl(paid));
        }

        save(KEY_TREASURY, { kwota: amount, czas: Date.now() });
    }

    function setMembers(nicks) {
        save(KEY_MEMBERS, { nicki: nicks.map((n) => String(n).trim()), aktualizacja: new Date().toLocaleString('pl-PL'), zrodlo: 'reczna' });
        console.log('[Składki] Ręcznie ustawiono listę klanowiczów: ' + nicks.length + ' osób');
    }

    function clanMembers() {
        return load(KEY_MEMBERS, { nicki: [], aktualizacja: null });
    }

    function dateFromDay(day) {
        const x = day.split('.');
        return new Date(+x[2], +x[1] - 1, +x[0]).getTime();
    }

    function setStart(day) {
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(day)) {
            console.log('[Składki] Podaj datę w formacie dd.mm.rrrr, np. skladki.ustawStart("05.07.2026")');
            return;
        }
        save(KEY_START, day);
        const stored = load(KEY_PAYMENTS, {});
        let removed = 0;
        Object.keys(stored).forEach((id) => {
            if (dateFromDay(stored[id].dzien) < dateFromDay(day)) {
                delete stored[id];
                removed++;
            }
        });
        save(KEY_PAYMENTS, stored);
        console.log('[Składki] Zbieram wpłaty od ' + day + (removed ? ' (usunięto starszych wpisów: ' + removed + ')' : ''));
    }

    function removeStart() {
        localStorage.removeItem(KEY_START);
        console.log('[Składki] Zbieram wszystkie wpłaty bez ograniczenia daty');
    }

    function backupJson() {
        return JSON.stringify({
            wplaty: load(KEY_PAYMENTS, {}),
            logi: load(KEY_OTHER_LOGS, {}),
            czlonkowie: load(KEY_MEMBERS, { nicki: [] }),
            multikonta: load(KEY_MULTI_ACCOUNTS, {}),
            czarnaLista: load(KEY_BLACKLIST, []),
            ignorowane: load(KEY_IGNORED, {}),
            wymaganeSkladki: load(KEY_REQUIRED, {}),
            poziomy: load(KEY_LEVELS, {}),
            migracje: load(KEY_MIGRATIONS, {}),
            start: load(KEY_START, null)
        });
    }

    function backup() {
        const blob = new Blob([backupJson()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'skladki-kopia-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        console.log('[Składki] Pobrano kopię zapasową');
    }

    function restore(stored) {
        if (typeof stored === 'string') stored = JSON.parse(stored);
        const payments = load(KEY_PAYMENTS, {});
        let newCount = 0;
        Object.keys(stored.wplaty || {}).forEach((id) => {
            if (!payments[id]) {
                payments[id] = stored.wplaty[id];
                newCount++;
            }
        });
        save(KEY_PAYMENTS, payments);
        const logs = load(KEY_OTHER_LOGS, {});
        let newLogs = 0;
        Object.keys(stored.logi || {}).forEach((id) => {
            if (!logs[id]) {
                logs[id] = stored.logi[id];
                newLogs++;
            }
        });
        save(KEY_OTHER_LOGS, logs);
        if (stored.multikonta) save(KEY_MULTI_ACCOUNTS, Object.assign({}, stored.multikonta, load(KEY_MULTI_ACCOUNTS, {})));
        if (stored.czarnaLista) save(KEY_BLACKLIST, [...new Set(load(KEY_BLACKLIST, []).concat(stored.czarnaLista))]);
        if (stored.ignorowane) save(KEY_IGNORED, Object.assign({}, stored.ignorowane, load(KEY_IGNORED, {})));
        if (stored.wymaganeSkladki) save(KEY_REQUIRED, Object.assign({}, stored.wymaganeSkladki, load(KEY_REQUIRED, {})));
        if (stored.poziomy) save(KEY_LEVELS, Object.assign({}, clampLevelMap(stored.poziomy), load(KEY_LEVELS, {})));
        if (stored.migracje) save(KEY_MIGRATIONS, Object.assign({}, stored.migracje, load(KEY_MIGRATIONS, {})));
        const localMembers = load(KEY_MEMBERS, { nicki: [] });
        if (stored.czlonkowie && stored.czlonkowie.nicki && stored.czlonkowie.nicki.length && localMembers.zrodlo !== 'skarbiec' && localMembers.zrodlo !== 'reczna') save(KEY_MEMBERS, stored.czlonkowie);
        if (stored.start && !load(KEY_START, null)) save(KEY_START, stored.start);
        console.log('[Składki] Wczytano kopię, dograno wpłat: ' + newCount + ', innych zdarzeń: ' + newLogs);
    }

    function setWebhook(url) {
        if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
            console.log('[Składki] To nie wygląda na adres webhooka Discorda. Wklej pełny adres z ustawień kanału (Integracje -> Webhooki).');
            return;
        }
        save(KEY_WEBHOOK, url);
        console.log('[Składki] Webhook zapisany. Kopia będzie wysyłana przy każdym otwarciu historii klanu.');
    }

    function setClanWebhook(url) {
        if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
            console.log('[Składki] To nie wygląda na adres webhooka Discorda. Wklej pełny adres z ustawień kanału (Integracje -> Webhooki).');
            return;
        }
        save(KEY_CLAN_WEBHOOK, url);
        console.log('[Składki] Webhook zapisany. Kopia będzie wysyłana przy każdym otwarciu historii klanu.');
    }

    function removeWebhook() {
        save(KEY_WEBHOOK, 'wylaczony');
        console.log('[Składki] Wysyłka na Discorda wyłączona');
    }

    function removeClanWebhook() {
        save(KEY_CLAN_WEBHOOK, 'wylaczony');
        console.log('[Składki] Wysyłka na Discorda wyłączona');
    }

    function getWebhook() {
        const w = load(KEY_WEBHOOK, null);
        if (w === 'wylaczony') return null;
        return w || DEFAULT_WEBHOOK;
    }

    function getClanWebhook() {
        const w = load(KEY_CLAN_WEBHOOK, null);
        if (w === 'wylaczony') return null;
        return w || CLAN_WEBHOOK;
    }

    function sendBackupToDiscord() {
        const url = getWebhook();
        if (!url) {
            console.log('[Składki] Wysyłka wyłączona. Włącz przez skladki.ustawWebhook("https://discord.com/api/webhooks/...")');
            return;
        }
        const count = Object.keys(load(KEY_PAYMENTS, {})).length;
        const fd = new FormData();
        fd.append('payload_json', JSON.stringify({ content: 'Kopia składek z ' + new Date().toLocaleString('pl-PL') + ' (wpłat w rejestrze: ' + count + ') — utworzył: **' + myNick() + '**' }));
        fd.append('files[0]', new Blob([backupJson()], { type: 'application/json' }), 'skladki-kopia-' + new Date().toISOString().slice(0, 10) + '.json');
        fetch(url, { method: 'POST', body: fd })
            .then((r) => {
                if (r.ok) {
                    console.log('[Składki] Kopia wysłana na Discorda');
                } else {
                    console.log('[Składki] Discord odrzucił wysyłkę, kod: ' + r.status);
                }
            })
            .catch((e) => console.log('[Składki] Błąd wysyłki na Discorda: ' + e.message));
    }

    function buildImage() {
        const m = buildMatrix();
        const levels = load(KEY_LEVELS, {});
        const required = load(KEY_REQUIRED, {});
        const joins = joinDates();

        const lineH = 16;
        const padX = 6;
        const padY = 5;
        const wNick = 220;
        const wFee = 80;
        const wDay = 105;
        const wSum = 80;
        const wBalance = 80;
        const colWidth = wNick + wFee + m.dni.length * wDay + wSum + wBalance;

        const collapsed = m.nicki.filter((n) => !m.spozaKlanu.includes(n) && !m.czarna.includes(n) && m.multi[n]);
        const collapsedEx = m.nicki.filter((n) => m.spozaKlanu.includes(n));
        const shown = m.nicki.filter((n) => collapsed.indexOf(n) < 0 && collapsedEx.indexOf(n) < 0);
        const sections = [
            { nicki: collapsed, tekst: 'Multikonta (drugie konta)', kolor: '#c99bf0' },
            { nicki: collapsedEx, tekst: 'Nie ma ich już w klanie', kolor: '#e08080' }
        ].filter((s) => s.nicki.length);

        const rows = shown.map((nick) => {
            let lines = m.multi[nick] ? 2 : 1;
            m.dni.forEach((d) => {
                const l = m.komorki[nick + '|' + d];
                if (l && l.length > lines) lines = l.length;
            });
            return { nick: nick, h: lines * lineH + padY * 2 };
        });
        const headerHeight = lineH + padY * 2;
        const sectionHeight = lineH + padY * 2;
        const height = headerHeight + rows.reduce((s, w) => s + w.h, 0) + sections.length * sectionHeight;

        const c = document.createElement('canvas');
        c.width = colWidth;
        c.height = height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, colWidth, height);
        ctx.textBaseline = 'middle';

        const cell = (x, y, w, h, bg) => {
            ctx.fillStyle = bg;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#444';
            ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        };

        const text = (t, x, y, color, maxW, bold) => {
            ctx.fillStyle = color;
            ctx.font = (bold ? 'bold ' : '') + '12px Arial';
            let s = String(t);
            while (ctx.measureText(s).width > maxW - padX * 2 && s.length > 1) s = s.slice(0, -2) + '…';
            ctx.fillText(s, x + padX, y);
        };

        let x = 0;
        const columns = [{ t: 'Nick', w: wNick }, { t: 'Składka', w: wFee }]
            .concat(m.dni.map((d) => ({ t: d, w: wDay })))
            .concat([{ t: 'Suma', w: wSum }, { t: '+/-', w: wBalance }]);
        columns.forEach((k) => {
            cell(x, 0, k.w, headerHeight, '#2b2b2b');
            text(k.t, x, headerHeight / 2, '#d4af37', k.w, true);
            x += k.w;
        });

        let y = headerHeight;
        rows.forEach((wr) => {
            const nick = wr.nick;
            let nickBg = '#2b2b2b';
            let nickColor = '#e0e0e0';
            if (m.spozaKlanu.includes(nick)) {
                nickBg = '#8a2626';
                nickColor = '#ffd7d7';
            } else if (m.czarna.includes(nick)) {
                nickBg = '#b8b8b8';
                nickColor = '#3a3a3a';
            } else if (m.multi[nick]) {
                nickBg = '#5e2d80';
                nickColor = '#ecd9fb';
            } else if (m.nowi.includes(nick)) {
                nickBg = '#1f8f8f';
                nickColor = '#d8ffff';
            }

            x = 0;
            cell(x, y, wNick, wr.h, nickBg);
            text(nick + (levels[nick] ? ' (' + levels[nick] + ')' : ''), x, y + padY + lineH / 2, nickColor, wNick, true);
            if (m.multi[nick]) text('(' + m.multi[nick] + ')', x, y + padY + lineH * 1.5, nickColor, wNick, false);
            x += wNick;

            cell(x, y, wFee, wr.h, '#3a2f14');
            if (required[nick]) text(zl(required[nick]), x, y + padY + lineH / 2, '#ffc233', wFee, true);
            x += wFee;

            m.dni.forEach((d) => {
                const l = m.komorki[nick + '|' + d];
                if (l) {
                    cell(x, y, wDay, wr.h, '#1f1f1f');
                    l.forEach((pay, i) => {
                        const yy = y + padY + lineH * i + lineH / 2;
                        if (pay.notka) {
                            text(pay.notka, x, yy, '#ffc233', wDay, true);
                        } else {
                            text(zl(pay.kwota) + ' (' + pay.godzina + ')', x, yy, pay.custom ? '#ffc233' : '#e0e0e0', wDay, false);
                        }
                    });
                } else if (joins[nick] && dateFromDay(d) < joins[nick]) {
                    cell(x, y, wDay, wr.h, '#9a9a9a');
                } else {
                    cell(x, y, wDay, wr.h, '#3a1f1f');
                }
                x += wDay;
            });

            cell(x, y, wSum, wr.h, '#26331f');
            text(m.sumy[nick] ? zl(m.sumy[nick]) : '0', x, y + padY + lineH / 2, '#9cd67a', wSum, true);
            x += wSum;

            if (required[nick]) {
                const b = (m.sumy[nick] || 0) - required[nick];
                cell(x, y, wBalance, wr.h, b >= 0 ? '#26331f' : '#3a1f1f');
                text((b >= 0 ? '+' : '-') + zl(Math.abs(b)), x, y + padY + lineH / 2, b >= 0 ? '#9cd67a' : '#e08080', wBalance, true);
            } else {
                cell(x, y, wBalance, wr.h, '#1f1f1f');
            }

            y += wr.h;
        });

        sections.forEach((s) => {
            cell(0, y, colWidth, sectionHeight, '#242424');
            const sy = y + sectionHeight / 2;
            ctx.fillStyle = s.kolor;
            ctx.beginPath();
            ctx.moveTo(padX + 2, sy - 5);
            ctx.lineTo(padX + 9, sy);
            ctx.lineTo(padX + 2, sy + 5);
            ctx.closePath();
            ctx.fill();
            text(s.tekst + ' — ' + s.nicki.length + ' (zwinięte, szczegóły w raporcie)', padX + 8, sy, s.kolor, colWidth - padX - 8, true);
            y += sectionHeight;
        });

        return c;
    }

    function sendScreenshot() {
        const url = getClanWebhook();
        if (!url) {
            console.log('[Składki] Wysyłka wyłączona. Włącz przez skladki.ustawWebhookKlanowy(...)');
            return;
        }
        buildImage().toBlob((blob) => {
            if (!blob) {
                console.log('[Składki] Nie udało się wygenerować obrazka');
                return;
            }
            const fd = new FormData();
            fd.append('payload_json', JSON.stringify({ content: 'Raport składek ' + new Date().toLocaleString('pl-PL') + ' — utworzył: **' + myNick() + '**' }));
            fd.append('files[0]', blob, 'raport-skladki-' + new Date().toISOString().slice(0, 10) + '.png');
            fetch(url, { method: 'POST', body: fd })
                .then((r) => {
                    if (r.ok) {
                        console.log('[Składki] Screen tabeli wysłany na Discorda');
                    } else {
                        console.log('[Składki] Discord odrzucił wysyłkę, kod: ' + r.status);
                    }
                })
                .catch((e) => console.log('[Składki] Błąd wysyłki na Discorda: ' + e.message));
        }, 'image/png');
    }

    let lastSend = 0;

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'k' && e.key !== 'K') return;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (Date.now() - lastSend < 60000) {
            console.log('[Składki] Odczekaj chwilę, wysyłka możliwa raz na minutę');
            return;
        }
        lastSend = Date.now();
        sendBackupToDiscord();
    });

    function loadBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            file.text().then((text) => {
                try {
                    restore(text);
                    alert('Kopia wczytana');
                } catch (e) {
                    alert('Nie udało się wczytać kopii: ' + e.message);
                }
            });
        });
        input.click();
    }

    function newMembers() {
        const now = Date.now();
        const result = [];
        Object.values(load(KEY_OTHER_LOGS, {})).forEach((l) => {
            const m = l.tresc.match(/^(.+?) - przystąpienie do klanu/);
            if (!m) return;
            const x = l.dzien.split('.');
            const g = l.godzina.split(':');
            const t = new Date(+x[2], +x[1] - 1, +x[0], +g[0], +g[1]).getTime();
            if (now - t < 48 * 3600 * 1000) result.push(m[1].trim());
        });
        return result;
    }

    function paymentSums() {
        const s = {};
        Object.values(load(KEY_PAYMENTS, {})).forEach((w) => {
            if (w.kwota) s[w.nick] = (s[w.nick] || 0) + w.kwota;
        });
        return s;
    }

    function joinDates() {
        const result = {};
        Object.values(load(KEY_OTHER_LOGS, {})).forEach((l) => {
            const m = l.tresc.match(/^(.+?) - przystąpienie do klanu/);
            if (!m) return;
            const nick = m[1].trim();
            const t = dateFromDay(l.dzien);
            if (!result[nick] || t > result[nick]) result[nick] = t;
        });
        return result;
    }

    function buildMatrix() {
        const payments = Object.entries(load(KEY_PAYMENTS, {})).map(([id, w]) => Object.assign({}, w, { custom: !!w.custom || id.indexOf('custom|') === 0 || id.indexOf('import|') === 0 }));
        payments.forEach((w) => {
            if (w.notka) w.kwota = 0;
        });
        const members = clanMembers().nicki;
        const multi = load(KEY_MULTI_ACCOUNTS, {});
        const blacklisted = load(KEY_BLACKLIST, []);
        const newcomers = newMembers();

        const days = [...new Set(payments.map((w) => w.dzien))].sort((a, b) => dateFromDay(b) - dateFromDay(a));
        const payers = [...new Set(payments.map((w) => w.nick))];
        const outsideClan = members.length ? payers.filter((n) => !members.includes(n)) : [];
        const nicks = [...new Set(members.concat(payers))];
        const group = (n) => (outsideClan.includes(n) ? 4 : blacklisted.includes(n) ? 2 : multi[n] ? 3 : newcomers.includes(n) ? 1 : 0);
        nicks.sort((a, b) => (group(a) - group(b)) || a.localeCompare(b, 'pl'));

        const cells = {};
        const sums = {};
        payments.forEach((w) => {
            const k = w.nick + '|' + w.dzien;
            if (!cells[k]) cells[k] = [];
            cells[k].push(w);
            sums[w.nick] = (sums[w.nick] || 0) + w.kwota;
        });

        Object.values(cells).forEach((list) => list.sort((a, b) => a.godzina.localeCompare(b.godzina)));

        return { dni: days, nicki: nicks, komorki: cells, sumy: sums, spozaKlanu: outsideClan, czlonkowie: members, multi: multi, czarna: blacklisted, nowi: newcomers };
    }

    const zl = (n) => {
        const abs = Math.abs(n);
        const f = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
        if (abs >= 1000000000) return f(n / 1000000000) + 'G';
        if (abs >= 1000000) return f(n / 1000000) + 'M';
        if (abs >= 1000) return f(n / 1000) + 'k';
        return String(n);
    };

    function report() {
        const m = buildMatrix();
        const levels = load(KEY_LEVELS, {});
        const joins = joinDates();
        const migrations = load(KEY_MIGRATIONS, {});
        if (!m.dni.length) {
            alert('Brak zapisanych wpłat. Otwórz najpierw historię klanu.');
            return;
        }

        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Składki klanowe</title><style>' +
            'body{background:#1a1a1a;color:#e0e0e0;font-family:Segoe UI,Arial,sans-serif;margin:16px}' +
            'h1{color:#d4af37;font-size:20px}' +
            '.info{color:#999;font-size:12px;margin-bottom:12px}' +
            '.tabela-wrap{overflow-x:auto}' +
            'table{border-collapse:collapse;font-size:12px;white-space:nowrap}' +
            'th,td{border:1px solid #444;padding:4px 8px;text-align:center}' +
            'th{background:#2b2b2b;color:#d4af37;position:sticky;top:0}' +
            'td:first-child,th:first-child{position:sticky;left:0;background:#2b2b2b;text-align:left;font-weight:bold;z-index:1}' +
            'td.brak{background:#3a1f1f}' +
            'td.nieobecny{background:#9a9a9a}' +
            'td.suma,th.suma{background:#26331f;color:#9cd67a;font-weight:bold}' +
            'td:first-child.ex{background:#8a2626;color:#ffd7d7}' +
            'td:first-child.czarna{background:#b8b8b8;color:#3a3a3a}' +
            'td:first-child.multi{background:#5e2d80;color:#ecd9fb}' +
            'td:first-child.nowy{background:#1f8f8f;color:#d8ffff}' +
            'tr.sekcja td,tr.sekcja td:first-child{position:static;background:#242424;border:1px solid #444;border-left:none;border-right:none;text-align:left;padding:7px 8px;cursor:pointer;font-weight:bold;user-select:none}' +
            'tr.sekcja td:hover{background:#2f2f2f}' +
            'tr.sekcja .etykieta{position:sticky;left:8px;display:inline-block}' +
            'tr.sekcja .strzalka{display:inline-block;width:14px}' +
            'tr.sekcja .ile{opacity:.6;font-weight:normal}' +
            'td .wl{font-size:10px;opacity:.8;font-style:italic;font-weight:normal}' +
            'td .lvl{font-size:10px;opacity:.75;font-weight:normal}' +
            'td .notka{background:#ffc233;color:#000;font-weight:900;font-style:italic;padding:0 4px;border-radius:3px;display:inline-block}' +
            '.godz{color:#8ab4d8;font-size:10px}' +
            '.legenda{margin-top:10px;font-size:12px;color:#999}' +
            'td.wymag{background:#3a2f14;color:#ffc233;font-weight:bold}' +
            'td.plus{background:#26331f;color:#9cd67a;font-weight:bold}' +
            'td.minus{background:#3a1f1f;color:#e08080;font-weight:bold}' +
            '</style></head><body>' +
            '<h1>Składki klanowe</h1>' +
            '<div class="info">Wpłat: ' + Object.keys(load(KEY_PAYMENTS, {})).length +
            ' | Klanowiczów na liście: ' + (m.czlonkowie.length || 'brak (otwórz zakładkę Członkowie)') +
            ' | Wygenerowano: ' + new Date().toLocaleString('pl-PL') + ' przez: ' + esc(myNick()) + '</div>';

        const required = load(KEY_REQUIRED, {});

        html += '<input id="szukaj" placeholder="Szukaj nicku..." style="margin-bottom:10px;padding:4px 8px;background:#2b2b2b;color:#e0e0e0;border:1px solid #555;border-radius:3px;width:220px;">' +
            '<button id="zapisz" style="margin-left:8px;padding:4px 10px;cursor:pointer;background:#26331f;color:#9cd67a;border:1px solid #9cd67a;border-radius:3px;">Zapisz plik</button>' +
            '<select id="sort" style="margin-left:8px;padding:4px 6px;background:#2b2b2b;color:#e0e0e0;border:1px solid #555;border-radius:3px;">' +
            [['nick', 'Sort: alfabetycznie'], ['lvl', 'Sort: poziom'], ['suma', 'Sort: suma wpłat'], ['bilansPlus', 'Sort: bilans (plusy na górze)'], ['bilansMinus', 'Sort: bilans (minusy na górze)']].map((o) => '<option value="' + o[0] + '"' + (o[0] === load(KEY_SORT, 'nick') ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
            '</select>' +
            '<div class="tabela-wrap"><table id="glowna"><tr><th>Nick</th><th>Składka</th>';

        m.dni.forEach((d) => (html += '<th>' + d + '</th>'));
        html += '<th class="suma">Suma</th><th class="suma">+/-</th></tr>';

        const nickClass = (nick) => {
            if (m.spozaKlanu.includes(nick)) return 'ex';
            if (m.czarna.includes(nick)) return 'czarna';
            if (m.multi[nick]) return 'multi';
            if (m.nowi.includes(nick)) return 'nowy';
            return '';
        };
        const gNumClass = { ex: 4, multi: 3, czarna: 2, nowy: 1 };
        const perGroup = (k) => m.nicki.filter((n) => nickClass(n) === k).length;
        const sections = {
            3: { tekst: 'Multikonta (drugie konta)', kolor: '#c99bf0', ile: perGroup('multi') },
            4: { tekst: 'Nie ma ich już w klanie', kolor: '#e08080', ile: perGroup('ex') }
        };
        const renderedSections = {};

        m.nicki.forEach((nick) => {
            const cls = nickClass(nick);
            const title = { ex: 'nie ma go już w klanie', czarna: 'czarna lista', multi: 'drugie konto gracza ' + m.multi[nick], nowy: 'w klanie krócej niż 48h' }[cls] || '';
            const gNum = gNumClass[cls] || 0;

            if (sections[gNum] && !renderedSections[gNum]) {
                renderedSections[gNum] = true;
                html += '<tr class="sekcja" data-sek="' + gNum + '" title="kliknij, aby rozwinąć lub zwinąć"><td colspan="' + (m.dni.length + 4) + '">' +
                    '<span class="etykieta" style="color:' + sections[gNum].kolor + '"><span class="strzalka">&#9654;</span>' + sections[gNum].tekst +
                    ' <span class="ile">(' + sections[gNum].ile + ')</span></span></td></tr>';
            }

            let note = cls === 'multi' ? '<br><span class="wl">(' + esc(m.multi[nick]) + ')</span>' : '';
            if (migrations[nick]) note += '<br><span class="wl">(dawniej: ' + esc(migrations[nick].stary) + ')</span>';
            const lvl = levels[nick] ? ' <span class="lvl">(' + esc(levels[nick]) + ')</span>' : '';
            html += '<tr data-g="' + gNum + '" data-nick="' + esc(nick) + '" data-lvl="' + (parseInt(levels[nick]) || 0) + '" data-suma="' + (m.sumy[nick] || 0) + '" data-bilans="' + ((m.sumy[nick] || 0) - (required[nick] || 0)) + '">' +
                '<td' + (cls ? ' class="' + cls + '" title="' + esc(title) + '"' : '') + '>' + esc(nick) + lvl + note + '</td>' +
                '<td class="wymag">' + (required[nick] ? zl(required[nick]) : '') + '</td>';
            m.dni.forEach((d) => {
                const list = m.komorki[nick + '|' + d];
                if (list) {
                    html += '<td>' + list.map((w) => (w.notka ? '<span class="notka">' + esc(w.notka) + '</span>' : w.custom ? '<span class="notka">' + zl(w.kwota) + '</span>' : zl(w.kwota)) + ' <span class="godz">(' + w.godzina + ')</span>').join('<br>') + '</td>';
                } else if (joins[nick] && dateFromDay(d) < joins[nick]) {
                    html += '<td class="nieobecny" title="nie było go jeszcze w klanie"></td>';
                } else {
                    html += '<td class="brak"></td>';
                }
            });
            html += '<td class="suma">' + (m.sumy[nick] ? zl(m.sumy[nick]) : '0') + '</td>';
            if (required[nick]) {
                const balance = (m.sumy[nick] || 0) - required[nick];
                html += '<td class="' + (balance >= 0 ? 'plus' : 'minus') + '">' + (balance >= 0 ? '+' : '-') + zl(Math.abs(balance)) + '</td></tr>';
            } else {
                html += '<td></td></tr>';
            }
        });

        html += '</table></div>' +
            '<div class="legenda">Kolor komórki z nickiem: <b style="color:#1f8f8f">turkus</b> — w klanie krócej niż 48h, <b style="color:#9b5fc4">fiolet</b> — drugie konto (najedź, by zobaczyć czyje), <b style="color:#b8b8b8">jasnoszary</b> — czarna lista, <b style="color:#c45b5b">czerwony</b> — nie ma go już w klanie. Ciemnoczerwone puste pole — brak wpłaty danego dnia. Szare puste pole — nie było go jeszcze wtedy w klanie. Kolumna +/- — nadwyżka (zielona) lub zaległość (czerwona) względem wymaganej składki.<br>Multikonta i osoby spoza klanu są na dole w osobnych, zwiniętych sekcjach — kliknij nagłówek sekcji, żeby ją rozwinąć. Wyszukiwarka przeszukuje też sekcje zwinięte.</div>';

        const logs = Object.values(load(KEY_OTHER_LOGS, {})).sort((a, b) => (dateFromDay(b.dzien) - dateFromDay(a.dzien)) || b.godzina.localeCompare(a.godzina));
        if (logs.length) {
            html += '<h1>Pozostałe zdarzenia</h1><div class="tabela-wrap"><table><tr><th>Data/godzina</th><th>Zdarzenie</th></tr>';
            logs.forEach((l) => {
                html += '<tr><td>' + l.dzien + ' ' + l.godzina + '</td><td style="text-align:left">' + esc(l.tresc) + '</td></tr>';
            });
            html += '</table></div>';
        }

        html += '<script>var szukajEl=document.getElementById("szukaj");var stanSekcji={"3":false,"4":false};' +
            'function odswiezWidok(){var q=szukajEl.value.trim().toLowerCase();var pasujace={};' +
            'document.querySelectorAll("#glowna tr[data-g]").forEach(function(tr){var g=tr.dataset.g;' +
            'var pasuje=!q||tr.dataset.nick.toLowerCase().indexOf(q)>=0;' +
            'var otwarta=q?true:stanSekcji[g]!==false;' +
            'tr.style.display=pasuje&&otwarta?"":"none";if(pasuje)pasujace[g]=(pasujace[g]||0)+1;});' +
            'document.querySelectorAll("#glowna tr.sekcja").forEach(function(n){n.style.display=!q||pasujace[n.dataset.sek]?"":"none";});}' +
            'document.querySelectorAll("#glowna tr.sekcja").forEach(function(n){n.addEventListener("click",function(){var s=n.dataset.sek;stanSekcji[s]=!stanSekcji[s];n.querySelector(".strzalka").innerHTML=stanSekcji[s]?"&#9660;":"&#9654;";odswiezWidok();});});' +
            'szukajEl.addEventListener("input",odswiezWidok);' +
            'document.getElementById("zapisz").addEventListener("click",function(){var b=new Blob(["<!DOCTYPE html>"+document.documentElement.outerHTML],{type:"text/html;charset=utf-8"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="raport-skladki-' + new Date().toISOString().slice(0, 10) + '.html";a.click();URL.revokeObjectURL(a.href);});' +
            'function sortujRaport(k){var rows=[].slice.call(document.querySelectorAll("#glowna tr[data-g]"));if(!rows.length)return;var tb=rows[0].parentNode;var nagl=[].slice.call(document.querySelectorAll("#glowna tr.sekcja"));rows.sort(function(a,b){var g=(+a.dataset.g)-(+b.dataset.g);if(g)return g;if(a.dataset.g==="0"&&k!=="nick"){var d=0;if(k==="bilansMinus")d=(+a.dataset.bilans)-(+b.dataset.bilans);else if(k==="bilansPlus")d=(+b.dataset.bilans)-(+a.dataset.bilans);else d=(+b.dataset[k])-(+a.dataset[k]);if(d)return d;}return a.dataset.nick.localeCompare(b.dataset.nick,"pl");});rows.forEach(function(r){tb.appendChild(r);});nagl.forEach(function(n){for(var i=0;i<rows.length;i++){if(rows[i].dataset.g===n.dataset.sek){tb.insertBefore(n,rows[i]);return;}}});}' +
            'var sortEl=document.getElementById("sort");sortEl.addEventListener("change",function(){sortujRaport(this.value);odswiezWidok();});if(sortEl.value!=="nick")sortujRaport(sortEl.value);odswiezWidok();<\/script>';
        html += '</body></html>';

        const popup = window.open('', '_blank');
        popup.document.write(html);
        popup.document.close();
    }

    function show() {
        console.table(Object.values(load(KEY_PAYMENTS, {})));
    }

    function clear() {
        localStorage.removeItem(KEY_PAYMENTS);
        localStorage.removeItem(KEY_OTHER_LOGS);
        localStorage.removeItem(KEY_MEMBERS);
        localStorage.removeItem(KEY_MULTI_ACCOUNTS);
        localStorage.removeItem(KEY_BLACKLIST);
        localStorage.removeItem(KEY_IGNORED);
        localStorage.removeItem(KEY_REQUIRED);
        localStorage.removeItem(KEY_REQUIRED_HISTORY);
        localStorage.removeItem(KEY_LEVELS);
        localStorage.removeItem(KEY_MIGRATIONS);
        localStorage.removeItem(KEY_TREASURY);
        console.log('[Składki] Rejestr wyczyszczony');
    }

    function findNick(query) {
        const everyone = new Set(clanMembers().nicki.concat(Object.values(load(KEY_PAYMENTS, {})).map((w) => w.nick)));
        for (const n of everyone) {
            if (n.toLowerCase() === query.toLowerCase()) return n;
        }
        return null;
    }

    function markMultiAccount(altArg, mainArg) {
        const multi = load(KEY_MULTI_ACCOUNTS, {});
        let alt = (altArg || prompt('Nick drugiego konta (multikonta):') || '').trim();
        if (!alt) return;
        alt = findNick(alt) || alt;

        if (multi[alt] && !mainArg) {
            if (confirm(alt + ' jest już oznaczony jako drugie konto gracza ' + multi[alt] + '.\nUsunąć to oznaczenie?')) {
                delete multi[alt];
                save(KEY_MULTI_ACCOUNTS, multi);
                console.log('[Składki] Usunięto oznaczenie multikonta: ' + alt);
            }
            return;
        }

        let main = (mainArg || prompt('Nick konta głównego (właściciela):') || '').trim();
        if (!main) return;
        main = findNick(main) || main;

        if (!findNick(alt) && !confirm('Nie znam gracza "' + alt + '". Zapisać mimo to?')) return;
        if (!findNick(main) && !confirm('Nie znam gracza "' + main + '". Zapisać mimo to?')) return;

        multi[alt] = main;
        save(KEY_MULTI_ACCOUNTS, multi);
        console.log('[Składki] Oznaczono: ' + alt + ' to drugie konto gracza ' + main);
    }

    function removeMultiAccount(alt) {
        const multi = load(KEY_MULTI_ACCOUNTS, {});
        const n = findNick(alt) || alt;
        if (!multi[n]) {
            console.log('[Składki] ' + n + ' nie jest oznaczony jako multikonto');
            return;
        }
        delete multi[n];
        save(KEY_MULTI_ACCOUNTS, multi);
        console.log('[Składki] Usunięto oznaczenie multikonta: ' + n);
    }

    function multiAccounts() {
        console.table(load(KEY_MULTI_ACCOUNTS, {}));
    }

    function markBlacklist(nickArg) {
        let nick = (nickArg || prompt('Nick gracza na czarną listę:') || '').trim();
        if (!nick) return;
        nick = findNick(nick) || nick;

        const blacklisted = load(KEY_BLACKLIST, []);
        const i = blacklisted.indexOf(nick);
        if (i >= 0) {
            if (confirm(nick + ' jest na czarnej liście.\nZdjąć go z niej?')) {
                blacklisted.splice(i, 1);
                save(KEY_BLACKLIST, blacklisted);
                console.log('[Składki] Zdjęto z czarnej listy: ' + nick);
            }
            return;
        }

        if (!findNick(nick) && !confirm('Nie znam gracza "' + nick + '". Dodać mimo to?')) return;

        blacklisted.push(nick);
        save(KEY_BLACKLIST, blacklisted);
        console.log('[Składki] Dodano na czarną listę: ' + nick);
    }

    function blacklist() {
        console.table(load(KEY_BLACKLIST, []));
    }

    function playerList() {
        return [...new Set(clanMembers().nicki.concat(Object.values(load(KEY_PAYMENTS, {})).map((w) => w.nick)))].sort((a, b) => a.localeCompare(b, 'pl'));
    }

    function closeList() {
        const p = document.querySelector('.skladki-lista');
        if (p) p.remove();
    }

    function showList(title, buildRow, nicks) {
        closeList();
        const p = document.createElement('div');
        p.className = 'skladki-lista';
        p.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2000;background:#1f1f1f;color:#ddd;border:1px solid #d4af37;border-radius:6px;padding:10px;width:340px;max-height:70vh;display:flex;flex-direction:column;font-size:12px;font-family:Arial,sans-serif;';

        const header = document.createElement('div');
        header.textContent = title;
        header.style.cssText = 'color:#d4af37;font-weight:bold;margin-bottom:8px;text-align:center;';
        p.appendChild(header);

        const search = document.createElement('input');
        search.placeholder = 'Szukaj nicku...';
        search.style.cssText = 'margin-bottom:6px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:3px 6px;';

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:3px;';
        (nicks || playerList()).forEach((nick) => {
            const w = buildRow(nick);
            if (!w) return;
            w.dataset.nick = nick;
            list.appendChild(w);
        });

        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            [...list.children].forEach((el) => {
                el.style.display = !q || (el.dataset.nick || '').toLowerCase().includes(q) ? '' : 'none';
            });
        });

        p.appendChild(search);
        p.appendChild(list);

        const closePanel = document.createElement('button');
        closePanel.textContent = 'Zamknij';
        closePanel.style.cssText = 'margin-top:8px;padding:3px;cursor:pointer;background:#2b2b2b;color:#d4af37;border:1px solid #d4af37;border-radius:3px;';
        closePanel.addEventListener('click', closeList);
        p.appendChild(closePanel);

        document.body.appendChild(p);
        return { p: p, lista: list };
    }

    function emptyBox(title, width) {
        closeList();
        const p = document.createElement('div');
        p.className = 'skladki-lista';
        p.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2000;background:#1f1f1f;color:#ddd;border:1px solid #d4af37;border-radius:6px;padding:10px;width:' + width + 'px;max-height:70vh;display:flex;flex-direction:column;font-size:12px;font-family:Arial,sans-serif;';
        const header = document.createElement('div');
        header.textContent = title;
        header.style.cssText = 'color:#d4af37;font-weight:bold;margin-bottom:8px;text-align:center;';
        p.appendChild(header);
        document.body.appendChild(p);
        return p;
    }

    function closeButton(p) {
        const b = document.createElement('button');
        b.textContent = 'Zamknij';
        b.style.cssText = 'margin-top:8px;padding:3px;cursor:pointer;background:#2b2b2b;color:#d4af37;border:1px solid #d4af37;border-radius:3px;';
        b.addEventListener('click', closeList);
        p.appendChild(b);
    }

    const pad = (x) => String(x).padStart(2, '0');

    function myNick() {
        try {
            if (window.Engine && window.Engine.hero && window.Engine.hero.d && window.Engine.hero.d.nick) return window.Engine.hero.d.nick;
        } catch (e) {}
        try {
            if (window.hero && window.hero.nick) return window.hero.nick;
        } catch (e) {}
        return 'nieznany';
    }

    function parseAmount(text) {
        const t = String(text).toLowerCase().replace(/\s/g, '').replace(',', '.');
        const m = t.match(/^(\d+(?:\.\d+)?)(kkk|kk|k|mln|m|g)?$/);
        if (!m) return NaN;
        const multiplier = { k: 1000, kk: 1000000, kkk: 1000000000, m: 1000000, mln: 1000000, g: 1000000000 }[m[2]] || 1;
        return Math.round(parseFloat(m[1]) * multiplier);
    }

    function parseFee(text) {
        const clean = String(text).trim().replace(',', '.').replace(/\s/g, '');
        if (/^\d+(\.\d+)?$/.test(clean) && parseFloat(clean) < 100000) return Math.round(parseFloat(clean) * 1000000);
        return parseAmount(text);
    }

    function saveRequired(newCount) {
        const historyEntries = load(KEY_REQUIRED_HISTORY, []);
        historyEntries.push(load(KEY_REQUIRED, {}));
        while (historyEntries.length > 10) historyEntries.shift();
        save(KEY_REQUIRED_HISTORY, historyEntries);
        save(KEY_REQUIRED, newCount);
    }

    function undoRequired() {
        const historyEntries = load(KEY_REQUIRED_HISTORY, []);
        if (!historyEntries.length) return false;
        save(KEY_REQUIRED, historyEntries.pop());
        save(KEY_REQUIRED_HISTORY, historyEntries);
        return true;
    }

    function panelProgressive() {
        const p = emptyBox('Składka progresywna wg poziomu', 360);

        let levelSource = load(KEY_LEVELS, {});
        let fromFile = false;

        const info = document.createElement('div');
        info.textContent = 'Poziomy: aktualne ze skanu (' + Object.keys(levelSource).length + ' graczy)';
        info.style.cssText = 'font-size:11px;color:#999;margin-bottom:6px;text-align:center;';
        p.appendChild(info);

        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Wczytaj poziomy z kopii JSON (z Discorda)';
        loadBtn.style.cssText = 'padding:4px;cursor:pointer;background:#143a3a;color:#7fd8d8;border:1px solid #7fd8d8;border-radius:3px;width:100%;margin-bottom:8px;';
        loadBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', () => {
                const file = input.files[0];
                if (!file) return;
                file.text().then((text) => {
                    try {
                        const stored = JSON.parse(text);
                        if (!stored.poziomy || !Object.keys(stored.poziomy).length) {
                            alert('Ta kopia nie zawiera poziomów graczy (stara wersja skryptu?)');
                            return;
                        }
                        levelSource = clampLevelMap(stored.poziomy);
                        fromFile = true;
                        info.textContent = 'Poziomy z kopii: ' + file.name + ' (' + Object.keys(levelSource).length + ' graczy)';
                        info.style.color = '#7fd8d8';
                    } catch (e) {
                        alert('Nie udało się wczytać pliku: ' + e.message);
                    }
                });
            });
            input.click();
        });
        p.appendChild(loadBtn);

        const description = document.createElement('div');
        description.textContent = 'Progi: lvl od / lvl do (puste = i wyżej) / kwota';
        description.style.cssText = 'font-size:11px;color:#999;margin-bottom:4px;';
        p.appendChild(description);

        const thresholdsBox = document.createElement('div');
        thresholdsBox.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:230px;overflow-y:auto;margin-bottom:6px;';
        p.appendChild(thresholdsBox);

        const thresholdRows = [];

        const addThreshold = (from, until, amount) => {
            const w = document.createElement('div');
            w.style.cssText = 'display:flex;gap:4px;align-items:center;';
            const mk = (val, ph, colWidth) => {
                const i = document.createElement('input');
                i.value = val;
                i.placeholder = ph;
                i.style.cssText = 'width:' + colWidth + 'px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:2px 4px;font-size:12px;text-align:center;';
                return i;
            };
            const fromIdx = mk(from, 'od', 50);
            const toIdx = mk(until, 'do', 50);
            const amountIdx = mk(amount, 'kwota', 90);
            const dash = document.createElement('span');
            dash.textContent = '–';
            const x = document.createElement('button');
            x.textContent = '×';
            x.style.cssText = 'padding:0 7px;cursor:pointer;background:#3a1f1f;color:#e08080;border:1px solid #e08080;border-radius:3px;';
            x.addEventListener('click', () => w.remove());
            w.appendChild(fromIdx);
            w.appendChild(dash);
            w.appendChild(toIdx);
            w.appendChild(amountIdx);
            w.appendChild(x);
            thresholdsBox.appendChild(w);
            thresholdRows.push({ w: w, odI: fromIdx, doI: toIdx, kwI: amountIdx });
        };

        load(KEY_THRESHOLDS, DEFAULT_THRESHOLDS).split('\n').forEach((line) => {
            let m = line.trim().match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
            if (m) {
                addThreshold(m[1], m[2], m[3]);
                return;
            }
            m = line.trim().match(/^(\d+)\s*\+\s+(.+)$/);
            if (m) addThreshold(m[1], '', m[2]);
        });

        const addThresholdBtn = document.createElement('button');
        addThresholdBtn.textContent = '+ dodaj próg';
        addThresholdBtn.style.cssText = 'padding:3px;cursor:pointer;background:#2b2b2b;color:#d4af37;border:1px solid #d4af37;border-radius:3px;width:100%;margin-bottom:6px;font-size:11px;';
        addThresholdBtn.addEventListener('click', () => addThreshold('', '', ''));
        p.appendChild(addThresholdBtn);

        const mode = document.createElement('select');
        mode.style.cssText = 'width:100%;margin-bottom:6px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:3px;';
        [['dodaj', 'Dodaj do obecnych składek'], ['ustaw', 'Ustaw jako składkę (nadpisz)']].forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o[0];
            opt.textContent = o[1];
            mode.appendChild(opt);
        });
        p.appendChild(mode);

        const applyChanges = document.createElement('button');
        applyChanges.textContent = 'Nalicz klanowiczom';
        applyChanges.style.cssText = 'padding:5px;cursor:pointer;background:#3a2f14;color:#ffc233;border:1px solid #ffc233;border-radius:3px;width:100%;';
        applyChanges.addEventListener('click', () => {
            const thresholds = [];
            for (const r of thresholdRows) {
                if (!r.w.isConnected) continue;
                if (!r.odI.value.trim() && !r.doI.value.trim() && !r.kwI.value.trim()) continue;
                const from = parseInt(r.odI.value, 10);
                const until = r.doI.value.trim() === '' ? 99999 : parseInt(r.doI.value, 10);
                const k = parseFee(r.kwI.value);
                if (!(from >= 1) || !(until >= from) || !(k > 0)) {
                    alert('Popraw próg: "' + r.odI.value + ' - ' + r.doI.value + ' : ' + r.kwI.value + '"');
                    return;
                }
                thresholds.push({ od: from, do: until, kwota: k });
            }
            if (!thresholds.length) {
                alert('Tabela progów jest pusta');
                return;
            }
            if (!fromFile && !confirm('Nie wczytałeś pliku z poziomami!\nSkładka zostanie naliczona wg AKTUALNYCH poziomów ze skanu, a nie z dnia ogłoszenia.\n\nKontynuować?')) return;
            save(KEY_THRESHOLDS, thresholds.map((pr) => pr.od + (pr.do >= 99999 ? '+ ' : '-' + pr.do + ' ') + zl(pr.kwota)).join('\n'));

            const membersData = clanMembers().nicki;
            const d = load(KEY_REQUIRED, {});
            const skippedPlayers = [];
            let charged = 0;
            membersData.forEach((nick) => {
                const lvl = parseInt(levelSource[nick]) || 0;
                if (!lvl) {
                    skippedPlayers.push(nick);
                    return;
                }
                const threshold = thresholds.find((pr) => lvl >= pr.od && lvl <= pr.do);
                if (!threshold) {
                    skippedPlayers.push(nick + ' (lvl ' + lvl + ' poza progami)');
                    return;
                }
                d[nick] = mode.value === 'dodaj' ? (d[nick] || 0) + threshold.kwota : threshold.kwota;
                charged++;
            });
            saveRequired(d);
            console.log('[Składki] Naliczono progresywną składkę: ' + charged + ' graczom');
            if (skippedPlayers.length) {
                console.log('[Składki] Pominięci przy naliczaniu (' + skippedPlayers.length + '):');
                console.table(skippedPlayers);
            }
            alert('Naliczono ' + charged + ' graczom.' + (skippedPlayers.length ? '\n\nPominięci (brak poziomu):\n' + skippedPlayers.join(', ') + '\n\n(lista jest też w konsoli F12)' : ''));
            panelFee();
        });
        p.appendChild(applyChanges);

        closeButton(p);
    }

    function panelFee() {
        const checkboxes = {};
        const fields = {};
        const rowMap = {};
        const memberList = clanMembers().nicki;
        const multi = load(KEY_MULTI_ACCOUNTS, {});
        const blacklisted = load(KEY_BLACKLIST, []);
        const newcomers = newMembers();
        const order = (n) => (blacklisted.includes(n) ? 3 : multi[n] ? 2 : newcomers.includes(n) ? 1 : 0);
        const criterion = load(KEY_SORT, 'nick');
        const sums = paymentSums();
        const levelMap = load(KEY_LEVELS, {});
        const requiredMap = load(KEY_REQUIRED, {});
        const sorted = playerList().sort((a, b) => {
            const g = order(a) - order(b);
            if (g) return g;
            if (order(a) === 0 && criterion !== 'nick') {
                let d = 0;
                if (criterion === 'lvl') d = (parseInt(levelMap[b]) || 0) - (parseInt(levelMap[a]) || 0);
                if (criterion === 'suma') d = (sums[b] || 0) - (sums[a] || 0);
                if (criterion === 'bilansPlus') d = ((sums[b] || 0) - (requiredMap[b] || 0)) - ((sums[a] || 0) - (requiredMap[a] || 0));
                if (criterion === 'bilansMinus') d = ((sums[a] || 0) - (requiredMap[a] || 0)) - ((sums[b] || 0) - (requiredMap[b] || 0));
                if (d) return d;
            }
            return a.localeCompare(b, 'pl');
        });

        const handle = showList('Składki — ile łącznie powinien mieć wpłacone', (nick) => {
            if (memberList.length && !memberList.includes(nick)) return null;
            const w = document.createElement('label');
            w.style.cssText = 'display:flex;align-items:center;gap:6px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            const et = document.createElement('span');
            et.textContent = nick;
            et.style.cssText = 'flex:1;';
            if (blacklisted.includes(nick)) {
                et.style.color = '#b8b8b8';
                et.style.fontStyle = 'italic';
            } else if (multi[nick]) {
                et.style.color = '#c99bf0';
            } else if (newcomers.includes(nick)) {
                et.style.color = '#4fd1d1';
            }
            const field = document.createElement('input');
            field.placeholder = 'np. 5M';
            field.style.cssText = 'width:90px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:1px 4px;font-size:11px;';
            const required = load(KEY_REQUIRED, {});
            if (required[nick]) field.value = zl(required[nick]);
            field.addEventListener('change', () => {
                const d = load(KEY_REQUIRED, {});
                const t = field.value.trim();
                const zn = t.match(/^([+-])\s*(.+)$/);
                if (zn) {
                    const k = parseFee(zn[2]);
                    if (k > 0) {
                        const newValue = (d[nick] || 0) + (zn[1] === '+' ? k : -k);
                        if (newValue > 0) {
                            d[nick] = newValue;
                        } else {
                            delete d[nick];
                        }
                    }
                } else {
                    const k = parseFee(t);
                    if (k > 0) {
                        d[nick] = k;
                    } else {
                        delete d[nick];
                    }
                }
                saveRequired(d);
                field.value = d[nick] ? zl(d[nick]) : '';
            });
            checkboxes[nick] = cb;
            fields[nick] = field;
            rowMap[nick] = w;
            w.appendChild(cb);
            w.appendChild(et);
            w.appendChild(field);
            return w;
        }, sorted);

        const visible = () => Object.keys(rowMap).filter((n) => rowMap[n].style.display !== 'none');

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;';
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;';

        const check = document.createElement('button');
        check.textContent = 'Zaznacz wszystkich';
        check.style.cssText = 'padding:2px 6px;cursor:pointer;background:#2b2b2b;color:#d4af37;border:1px solid #d4af37;border-radius:3px;font-size:11px;';
        check.addEventListener('click', () => {
            const list = visible();
            const allSelected = list.every((n) => checkboxes[n].checked);
            list.forEach((n) => (checkboxes[n].checked = !allSelected));
        });

        const bulk = document.createElement('input');
        bulk.placeholder = 'np. 5M (0 czyści)';
        bulk.style.cssText = 'flex:1;min-width:120px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:4px 6px;font-size:13px;';

        const setValue = document.createElement('button');
        setValue.textContent = 'Ustaw zaznaczonym';
        setValue.style.cssText = 'padding:2px 6px;cursor:pointer;background:#26331f;color:#9cd67a;border:1px solid #9cd67a;border-radius:3px;font-size:11px;';
        setValue.addEventListener('click', () => {
            const selected = Object.keys(checkboxes).filter((n) => checkboxes[n].checked);
            if (!selected.length) {
                alert('Najpierw zaznacz graczy');
                return;
            }
            const k = parseFee(bulk.value);
            const clearing = !bulk.value.trim() || k === 0;
            if (!clearing && !(k > 0)) {
                alert('Podaj kwotę (np. 5M), albo 0 lub puste pole, żeby wyczyścić');
                return;
            }
            const d = load(KEY_REQUIRED, {});
            selected.forEach((n) => {
                if (clearing) {
                    delete d[n];
                } else {
                    d[n] = k;
                }
                fields[n].value = d[n] ? zl(d[n]) : '';
            });
            saveRequired(d);
            console.log('[Składki] Ustawiono składkę ' + (clearing ? '(wyczyszczono)' : zl(k)) + ' dla graczy: ' + selected.length);
        });

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Dodaj zaznaczonym';
        addBtn.style.cssText = 'padding:2px 6px;cursor:pointer;background:#3a2f14;color:#ffc233;border:1px solid #ffc233;border-radius:3px;font-size:11px;';
        addBtn.addEventListener('click', () => {
            const selected = Object.keys(checkboxes).filter((n) => checkboxes[n].checked);
            if (!selected.length) {
                alert('Najpierw zaznacz graczy');
                return;
            }
            const t = bulk.value.trim();
            const negative = t.indexOf('-') === 0;
            const k = parseFee(negative ? t.slice(1) : t);
            if (!(k > 0)) {
                alert('Podaj kwotę do dodania, np. 7kk (albo -7kk, żeby odjąć)');
                return;
            }
            const d = load(KEY_REQUIRED, {});
            selected.forEach((n) => {
                const newValue = (d[n] || 0) + (negative ? -k : k);
                if (newValue > 0) {
                    d[n] = newValue;
                } else {
                    delete d[n];
                }
                fields[n].value = d[n] ? zl(d[n]) : '';
            });
            saveRequired(d);
            console.log('[Składki] ' + (negative ? 'Odjęto ' : 'Dodano ') + zl(k) + ' składki dla graczy: ' + selected.length);
        });

        const undo = document.createElement('button');
        undo.textContent = 'Cofnij';
        undo.style.cssText = 'padding:2px 6px;cursor:pointer;background:#143a3a;color:#7fd8d8;border:1px solid #7fd8d8;border-radius:3px;font-size:11px;';
        undo.addEventListener('click', () => {
            if (!undoRequired()) {
                alert('Nie ma czego cofnąć');
                return;
            }
            const d = load(KEY_REQUIRED, {});
            Object.keys(fields).forEach((n) => (fields[n].value = d[n] ? zl(d[n]) : ''));
            console.log('[Składki] Cofnięto ostatnią zmianę składek');
        });

        const sortSel = document.createElement('select');
        sortSel.style.cssText = 'background:#2b2b2b;color:#ddd;border:1px solid #555;font-size:11px;padding:2px;';
        [['nick', 'Sort: alfabet.'], ['lvl', 'Sort: poziom'], ['suma', 'Sort: suma'], ['bilansPlus', 'Sort: bilans +'], ['bilansMinus', 'Sort: bilans -']].forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o[0];
            opt.textContent = o[1];
            sortSel.appendChild(opt);
        });
        sortSel.value = criterion;
        sortSel.addEventListener('change', () => {
            save(KEY_SORT, sortSel.value);
            panelFee();
        });

        const thresholdBar = document.createElement('div');
        thresholdBar.style.cssText = 'margin-bottom:6px;';
        const thresholdBtn = document.createElement('button');
        thresholdBtn.textContent = 'Progresywna wg lvl';
        thresholdBtn.style.cssText = 'padding:2px 6px;cursor:pointer;background:#3a2f14;color:#ffc233;border:1px solid #ffc233;border-radius:3px;font-size:11px;width:100%;';
        thresholdBtn.addEventListener('click', panelProgressive);
        thresholdBar.appendChild(thresholdBtn);

        bar.appendChild(check);
        bar.appendChild(bulk);
        actionBar.appendChild(setValue);
        actionBar.appendChild(addBtn);
        actionBar.appendChild(undo);
        actionBar.appendChild(sortSel);
        handle.p.insertBefore(bar, handle.lista);
        handle.p.insertBefore(actionBar, handle.lista);
        handle.p.insertBefore(thresholdBar, handle.lista);
    }

    function panelAddEntry() {
        const p = emptyBox('Dodaj własny wpis', 280);
        const now = new Date();

        const field = (label, input) => {
            const w = document.createElement('label');
            w.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
            const t = document.createElement('span');
            t.textContent = label;
            t.style.cssText = 'width:70px;';
            input.style.cssText = 'flex:1;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:2px 4px;';
            w.appendChild(t);
            w.appendChild(input);
            p.appendChild(w);
            return input;
        };

        const nick = document.createElement('input');
        nick.setAttribute('list', 'skladki-gracze');
        const dl = document.createElement('datalist');
        dl.id = 'skladki-gracze';
        playerList().forEach((g) => {
            const o = document.createElement('option');
            o.value = g;
            dl.appendChild(o);
        });
        p.appendChild(dl);

        const amount = document.createElement('input');
        amount.placeholder = 'np. 5kk, 500k albo dowolny tekst';
        const dateStr = document.createElement('input');
        dateStr.type = 'date';
        dateStr.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
        const hour = document.createElement('input');
        hour.type = 'time';
        hour.value = pad(now.getHours()) + ':' + pad(now.getMinutes());

        field('Nick:', nick);
        field('Kwota/notka:', amount);
        field('Data:', dateStr);
        field('Godzina:', hour);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Dodaj wpis';
        saveBtn.style.cssText = 'margin-top:4px;padding:3px;cursor:pointer;background:#26331f;color:#9cd67a;border:1px solid #9cd67a;border-radius:3px;';
        saveBtn.addEventListener('click', () => {
            const n = nick.value.trim();
            const text = amount.value.trim();
            const k = parseAmount(text);
            const d = dateStr.value ? dateStr.value.split('-').reverse().join('.') : '';
            const g = hour.value.trim();
            if (!n || !text || !/^\d{2}\.\d{2}\.\d{4}$/.test(d) || !/^\d{2}:\d{2}$/.test(g)) {
                alert('Uzupełnij poprawnie: nick, kwotę lub notatkę, datę (dd.mm.rrrr) i godzinę (gg:mm)');
                return;
            }
            const stored = load(KEY_PAYMENTS, {});
            const entry = k > 0 ? { dzien: d, godzina: g, kwota: k, nick: n, custom: true } : { dzien: d, godzina: g, nick: n, notka: text, custom: true };
            stored['custom|' + d + ' ' + g + '|' + n + '|' + Date.now()] = entry;
            save(KEY_PAYMENTS, stored);
            console.log('[Składki] Dodano własny wpis: ' + n + ' — ' + (k > 0 ? k : text) + ' (' + d + ' ' + g + ')');
            closeList();
        });
        p.appendChild(saveBtn);
        closeButton(p);
    }

    function panelRemoveEntries(showIgnored) {
        const p = emptyBox('Usuń własne wpisy', 380);
        const stored = load(KEY_PAYMENTS, {});
        const ignoredList = load(KEY_IGNORED, {});
        const custom = Object.keys(stored).filter((id) => (id.startsWith('custom|') || id.startsWith('import|')) && !ignoredList[id]);
        const ignoredItems = Object.keys(stored).filter((id) => ignoredList[id]);

        const sortRows = (t) => t.sort((a, b) => (dateFromDay(stored[b].dzien) - dateFromDay(stored[a].dzien)) || stored[b].godzina.localeCompare(stored[a].godzina));
        sortRows(custom);
        sortRows(ignoredItems);

        const entryDescription = (w) => w.dzien + ' ' + w.godzina + ' — ' + w.nick + ': ' + (w.notka ? w.notka : zl(w.kwota));

        const smallButton = (text, color, bg, action) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'padding:1px 6px;cursor:pointer;background:' + bg + ';color:' + color + ';border:1px solid ' + color + ';border-radius:3px;font-size:11px;';
            b.addEventListener('click', action);
            return b;
        };

        const makeRow = (id, buttons) => {
            const w = stored[id];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;';
            const description = document.createElement('span');
            description.textContent = entryDescription(w);
            description.style.cssText = 'flex:1;';
            row.appendChild(description);
            buttons.forEach((b) => row.appendChild(b));
            return row;
        };

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:3px;';

        if (!custom.length) {
            const info = document.createElement('div');
            info.textContent = 'Brak własnych wpisów';
            info.style.cssText = 'text-align:center;color:#999;';
            list.appendChild(info);
        }

        custom.forEach((id) => {
            list.appendChild(makeRow(id, [
                smallButton('Schowaj', '#b8b8b8', '#3a3a3a', () => {
                    const ign = load(KEY_IGNORED, {});
                    ign[id] = true;
                    save(KEY_IGNORED, ign);
                    panelRemoveEntries(showIgnored);
                }),
                smallButton('Usuń', '#e08080', '#3a1f1f', () => {
                    const current = load(KEY_PAYMENTS, {});
                    delete current[id];
                    save(KEY_PAYMENTS, current);
                    panelRemoveEntries(showIgnored);
                })
            ]));
        });
        p.appendChild(list);

        const toggle = document.createElement('div');
        toggle.textContent = (showIgnored ? '▾ Zwiń schowane' : '▸ Rozwiń schowane') + ' (' + ignoredItems.length + ')';
        toggle.style.cssText = 'margin-top:8px;cursor:pointer;color:#d4af37;text-align:center;';
        toggle.addEventListener('click', () => panelRemoveEntries(!showIgnored));
        p.appendChild(toggle);

        if (showIgnored) {
            const ignoredNicks = document.createElement('div');
            ignoredNicks.style.cssText = 'overflow-y:auto;max-height:30vh;display:flex;flex-direction:column;gap:3px;margin-top:6px;opacity:.7;';
            if (!ignoredItems.length) {
                const info = document.createElement('div');
                info.textContent = 'Brak schowanych wpisów';
                info.style.cssText = 'text-align:center;color:#999;';
                ignoredNicks.appendChild(info);
            }
            ignoredItems.forEach((id) => {
                ignoredNicks.appendChild(makeRow(id, [
                    smallButton('Przywróć', '#9cd67a', '#26331f', () => {
                        const ign = load(KEY_IGNORED, {});
                        delete ign[id];
                        save(KEY_IGNORED, ign);
                        panelRemoveEntries(true);
                    })
                ]));
            });
            p.appendChild(ignoredNicks);
        }

        closeButton(p);
    }

    function moveData(oldItem, newItem) {
        let changes = 0;

        const payments = load(KEY_PAYMENTS, {});
        Object.keys(payments).forEach((id) => {
            if (payments[id].nick === oldItem) {
                payments[id].nick = newItem;
                changes++;
            }
        });
        save(KEY_PAYMENTS, payments);

        const logs = load(KEY_OTHER_LOGS, {});
        Object.keys(logs).forEach((id) => {
            if (logs[id].tresc.indexOf(oldItem + ' - ') === 0) {
                logs[id].tresc = newItem + logs[id].tresc.slice(oldItem.length);
                changes++;
            }
        });
        save(KEY_OTHER_LOGS, logs);

        const multi = load(KEY_MULTI_ACCOUNTS, {});
        if (multi[oldItem] !== undefined) {
            if (multi[newItem] === undefined) multi[newItem] = multi[oldItem];
            delete multi[oldItem];
            changes++;
        }
        Object.keys(multi).forEach((k) => {
            if (multi[k] === oldItem) {
                multi[k] = newItem;
                changes++;
            }
        });
        save(KEY_MULTI_ACCOUNTS, multi);

        const blacklisted = load(KEY_BLACKLIST, []);
        const ic = blacklisted.indexOf(oldItem);
        if (ic >= 0) {
            if (blacklisted.includes(newItem)) {
                blacklisted.splice(ic, 1);
            } else {
                blacklisted[ic] = newItem;
            }
            save(KEY_BLACKLIST, blacklisted);
            changes++;
        }

        const req = load(KEY_REQUIRED, {});
        if (req[oldItem] !== undefined) {
            if (req[newItem] === undefined) req[newItem] = req[oldItem];
            delete req[oldItem];
            save(KEY_REQUIRED, req);
            changes++;
        }

        const pos = load(KEY_LEVELS, {});
        if (pos[oldItem] !== undefined) {
            if (pos[newItem] === undefined) pos[newItem] = pos[oldItem];
            delete pos[oldItem];
            save(KEY_LEVELS, pos);
            changes++;
        }

        console.log('[Składki] Przeniesiono dane: ' + oldItem + ' -> ' + newItem + ' (zmian: ' + changes + ')');
        return changes;
    }

    function migrateNick(oldItem, newItem) {
        const changes = moveData(oldItem, newItem);
        const mig = load(KEY_MIGRATIONS, {});
        const original = mig[oldItem] ? mig[oldItem].stary : oldItem;
        delete mig[oldItem];
        mig[newItem] = { stary: original, data: new Date().toLocaleDateString('pl-PL') };
        save(KEY_MIGRATIONS, mig);
        return changes;
    }

    function undoMigrations(newItem) {
        const mig = load(KEY_MIGRATIONS, {});
        if (!mig[newItem]) {
            console.log('[Składki] Brak migracji do cofnięcia dla: ' + newItem);
            return 0;
        }
        const changes = moveData(newItem, mig[newItem].stary);
        delete mig[newItem];
        save(KEY_MIGRATIONS, mig);
        return changes;
    }

    function panelOther() {
        const p = emptyBox('Inne', 300);

        const bigButton = (text, color, bg, action) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'padding:5px;cursor:pointer;background:' + bg + ';color:' + color + ';border:1px solid ' + color + ';border-radius:3px;margin-bottom:6px;width:100%;';
            b.addEventListener('click', action);
            p.appendChild(b);
        };

        bigButton('Kopia zapasowa (pobierz plik)', '#9cd67a', '#26331f', backup);
        bigButton('Wczytaj kopię', '#7fd8d8', '#143a3a', loadBackup);

        const header = document.createElement('div');
        header.textContent = 'Zmiana nicku — przenieś dane';
        header.style.cssText = 'color:#d4af37;font-weight:bold;margin:8px 0 6px;text-align:center;';
        p.appendChild(header);

        const label = (text) => {
            const e = document.createElement('div');
            e.textContent = text;
            e.style.cssText = 'font-size:11px;color:#999;margin-bottom:2px;';
            p.appendChild(e);
        };

        const makeField = (listId, options) => {
            const dl = document.createElement('datalist');
            dl.id = listId;
            options.forEach((n) => {
                const o = document.createElement('option');
                o.value = n;
                dl.appendChild(o);
            });
            p.appendChild(dl);
            const i = document.createElement('input');
            i.setAttribute('list', listId);
            i.placeholder = 'Zacznij pisać nick...';
            i.style.cssText = 'width:100%;margin-bottom:6px;background:#2b2b2b;color:#ddd;border:1px solid #555;padding:3px;box-sizing:border-box;';
            p.appendChild(i);
            return i;
        };

        const known = [...new Set(playerList().concat(Object.keys(load(KEY_REQUIRED, {})), Object.keys(load(KEY_LEVELS, {}))))].sort((a, b) => a.localeCompare(b, 'pl'));
        const membersData = [...clanMembers().nicki].sort((a, b) => a.localeCompare(b, 'pl'));

        label('Stary nick (z niego przenosimy dane):');
        const oldField = makeField('skladki-mig-znani', known);
        label('Nowy nick (obecny w klanie):');
        const newField = makeField('skladki-mig-czlonkowie', membersData);

        const move = document.createElement('button');
        move.textContent = 'Przenieś dane';
        move.style.cssText = 'padding:5px;cursor:pointer;background:#3a2f14;color:#ffc233;border:1px solid #ffc233;border-radius:3px;width:100%;';
        move.addEventListener('click', () => {
            const s = known.find((x) => x.toLowerCase() === oldField.value.trim().toLowerCase());
            const n = membersData.find((x) => x.toLowerCase() === newField.value.trim().toLowerCase());
            if (!s || !n || s === n) {
                alert('Wpisz dwa różne, istniejące nicki (wybierz z podpowiedzi)');
                return;
            }
            if (!confirm('Przenieść wszystkie dane (wpłaty, składki, oznaczenia) z "' + s + '" na "' + n + '"?')) return;
            const changes = migrateNick(s, n);
            alert('Przeniesiono dane: ' + s + ' -> ' + n + ' (zmian: ' + changes + ')');
            panelOther();
        });
        p.appendChild(move);

        const mig = load(KEY_MIGRATIONS, {});
        const migNicks = Object.keys(mig).sort((a, b) => a.localeCompare(b, 'pl'));
        if (migNicks.length) {
            const header2 = document.createElement('div');
            header2.textContent = 'Wykonane migracje';
            header2.style.cssText = 'color:#d4af37;font-weight:bold;margin:8px 0 6px;text-align:center;';
            p.appendChild(header2);

            migNicks.forEach((newNick) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
                const description = document.createElement('span');
                description.textContent = mig[newNick].stary + ' → ' + newNick + ' (' + mig[newNick].data + ')';
                description.style.cssText = 'flex:1;font-size:11px;';
                const undoBtn = document.createElement('button');
                undoBtn.textContent = 'Cofnij';
                undoBtn.style.cssText = 'padding:1px 6px;cursor:pointer;background:#3a1f1f;color:#e08080;border:1px solid #e08080;border-radius:3px;font-size:11px;';
                undoBtn.addEventListener('click', () => {
                    if (!confirm('Cofnąć migrację? Dane wrócą z "' + newNick + '" na "' + mig[newNick].stary + '".')) return;
                    undoMigrations(newNick);
                    panelOther();
                });
                row.appendChild(description);
                row.appendChild(undoBtn);
                p.appendChild(row);
            });
        }

        closeButton(p);
    }

    function panelBlacklist() {
        showList('Czarna lista', (nick) => {
            const w = document.createElement('label');
            w.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = load(KEY_BLACKLIST, []).includes(nick);
            cb.addEventListener('change', () => {
                const blacklisted = load(KEY_BLACKLIST, []);
                const i = blacklisted.indexOf(nick);
                if (cb.checked && i < 0) blacklisted.push(nick);
                if (!cb.checked && i >= 0) blacklisted.splice(i, 1);
                save(KEY_BLACKLIST, blacklisted);
            });
            w.appendChild(cb);
            w.appendChild(document.createTextNode(nick));
            return w;
        });
    }

    function panelMulti() {
        const players = playerList();
        let dl = document.getElementById('skladki-multi-gracze');
        if (dl) dl.remove();
        dl = document.createElement('datalist');
        dl.id = 'skladki-multi-gracze';
        players.forEach((g) => {
            const o = document.createElement('option');
            o.value = g;
            dl.appendChild(o);
        });
        document.body.appendChild(dl);

        showList('Multikonta (zaznacz drugie konto i wpisz właściciela)', (nick) => {
            const w = document.createElement('label');
            w.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            const field = document.createElement('input');
            field.setAttribute('list', 'skladki-multi-gracze');
            field.placeholder = 'właściciel...';
            field.style.cssText = 'margin-left:auto;width:140px;background:#2b2b2b;color:#ddd;border:1px solid #555;font-size:11px;padding:1px 4px;';
            const multi = load(KEY_MULTI_ACCOUNTS, {});
            cb.checked = !!multi[nick];
            if (multi[nick]) field.value = multi[nick];
            field.style.display = cb.checked ? '' : 'none';
            const saveState = () => {
                const m = load(KEY_MULTI_ACCOUNTS, {});
                const wl = players.find((g) => g !== nick && g.toLowerCase() === field.value.trim().toLowerCase());
                if (cb.checked && wl) {
                    m[nick] = wl;
                    field.value = wl;
                    field.style.borderColor = '#555';
                } else if (cb.checked) {
                    delete m[nick];
                    field.style.borderColor = '#e08080';
                } else {
                    delete m[nick];
                    field.style.borderColor = '#555';
                }
                save(KEY_MULTI_ACCOUNTS, m);
                field.style.display = cb.checked ? '' : 'none';
            };
            cb.addEventListener('change', saveState);
            field.addEventListener('change', saveState);
            w.appendChild(cb);
            w.appendChild(document.createTextNode(nick));
            w.appendChild(field);
            return w;
        });
    }

    function logs() {
        console.table(Object.values(load(KEY_OTHER_LOGS, {})).sort((a, b) => (dateFromDay(b.dzien) - dateFromDay(a.dzien)) || b.godzina.localeCompare(a.godzina)));
    }

    function addButtons() {
        const popup = document.querySelector('.clan-history-content');
        if (!popup || popup.querySelector('.skladki-panel')) return;

        const panel = document.createElement('div');
        panel.className = 'skladki-panel';
        panel.style.cssText = 'position:absolute;top:2px;right:8px;z-index:10;display:flex;gap:10px;';

        const makeButton = (text, action, color, bg) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'font-size:11px;padding:2px 6px;cursor:pointer;background:' + (bg || '#2b2b2b') + ';color:' + (color || '#d4af37') + ';border:1px solid ' + (color || '#d4af37') + ';border-radius:3px;';
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                action();
            });
            return b;
        };

        const makeGroup = (buttons) => {
            const g = document.createElement('div');
            g.style.cssText = 'display:flex;gap:4px;';
            buttons.forEach((b) => g.appendChild(b));
            return g;
        };

        panel.appendChild(makeGroup([makeButton('Raport', report), makeButton('Screen', sendScreenshot, '#8ab4d8', '#14283a'), makeButton('Składka', panelFee, '#ffc233', '#3a2f14')]));
        panel.appendChild(makeGroup([makeButton('Dodaj wpis', panelAddEntry, '#ffc233', '#3a2f14'), makeButton('Usuń wpisy', panelRemoveEntries, '#e08080', '#3a1f1f')]));
        panel.appendChild(makeGroup([makeButton('Multikonto', panelMulti, '#c99bf0', '#2e1c3d'), makeButton('Czarna', panelBlacklist, '#b8b8b8', '#3a3a3a')]));
        panel.appendChild(makeGroup([makeButton('⋯ Inne', panelOther)]));
        popup.appendChild(panel);
    }

    function loop() {
        scanHistory();
        scanMembers();
        scanLevels();
        scanTreasury();
        addButtons();
    }

    window.skladki = {
        raport: report,
        pokaz: show,
        logi: logs,
        klanowicze: clanMembers,
        ustawKlanowiczow: setMembers,
        oznaczMultikonto: markMultiAccount,
        usunMultikonto: removeMultiAccount,
        multikonta: multiAccounts,
        oznaczCzarnaLista: markBlacklist,
        czarnaLista: blacklist,
        ustawStart: setStart,
        usunStart: removeStart,
        kopia: backup,
        wczytajKopie: loadBackup,
        migrujNick: migrateNick,
        cofnijMigracje: undoMigrations,
        przywroc: restore,
        ustawWebhook: setWebhook,
        ustawWebhookKlanowy: setClanWebhook,
        usunWebhook: removeWebhook,
        usunWebhookKlanowy: removeClanWebhook,
        wyslijKopieNaDiscord: sendBackupToDiscord,
        wyslijScreen: sendScreenshot,
        wyczysc: clear
    };

    migrate();
    seedMembers();
    setInterval(loop, 2000);
})();
