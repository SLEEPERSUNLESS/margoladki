# Margoladki – menedżer składek Margonem

Skrypt użytkownika do [Margonem](https://www.margonem.pl) (nowy interfejs), który spisuje wpłaty złota z historii klanu
i porównuje je z listą klanowiczów oraz wymaganymi składkami.

> [!IMPORTANT]
> **Skrypt działa w całości po stronie przeglądarki (frontend).**
> Nie korzysta z żadnego API ani serwera – dane odczytuje bezpośrednio ze strony gry, z tego co jest wyświetlone
> w oknie klanu (historia, skarbiec, członkowie). Wszystko zapisuje w `localStorage` przeglądarki, więc dane są
> widoczne tylko na tym komputerze i w tej przeglądarce. Wyczyszczenie danych przeglądarki usuwa też zapisane wpłaty.

## Funkcje

- Odczytuje wpłaty (`+N złota /Nick`) z historii klanu i zapisuje je lokalnie
- Pobiera listę klanowiczów i ich poziomy ze skarbca i zakładki członków
- Indywidualne składki dla graczy, w tym składka progresywna zależna od poziomu postaci
- Raport z wpłaconą kwotą, wymaganą składką i bilansem każdego gracza, z sortowaniem i wyszukiwaniem
- Oznaczanie multikont i czarnej listy, przenoszenie danych po zmianie nicku
- Eksport i import kopii zapasowej (JSON) oraz opcjonalna wysyłka kopii i screenów raportu przez webhook Discorda

## Instalacja

1. Zainstaluj menedżer skryptów, np. [Tampermonkey](https://www.tampermonkey.net/) lub Violentmonkey.
2. Otwórz plik [`skladki-klanowe.user.js`](skladki-klanowe.user.js) i kliknij **Raw** – menedżer zaproponuje instalację.
3. Zaloguj się do Margonem i otwórz okno klanu (historia / skarbiec) – dane zbierają się automatycznie.

## Użycie

Skrypt dodaje przyciski do okna klanu. Dodatkowe komendy są dostępne w konsoli przeglądarki (F12):

| Komenda | Opis |
| --- | --- |
| `skladki.raport()` | Pokazuje raport składek |
| `skladki.kopia()` / `skladki.wczytajKopie()` | Pobiera / wczytuje kopię zapasową |
| `skladki.ustawStart('DD.MM.RRRR')` | Pomija wpisy z historii starsze niż podany dzień |
| `skladki.migrujNick('stary', 'nowy')` | Przenosi dane po zmianie nicku |
| `skladki.ustawWebhook(url)` | Ustawia webhook Discorda dla kopii zapasowych |
| `skladki.ustawWebhookKlanowy(url)` | Ustawia webhook Discorda dla raportów klanowych |
| `skladki.usunWebhook()` / `skladki.usunWebhookKlanowy()` | Wyłącza wysyłkę na Discorda |

Webhooki Discorda **nie** są wbudowane w skrypt.

## Dane

Wszystkie dane są przechowywane w `localStorage` przeglądarki (klucze zaczynające się od `klanSkladki`).
Nic nie jest nigdzie wysyłane, dopóki nie ustawisz webhooka Discorda.
