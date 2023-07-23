# This repo is archived. This is a relic of my projects while learning programming. Feel free to inspect it if you are interested.
This was originally my private repo. I never had any chance to finish this project, so I decided to make it a public archive.
<b>Warning: this was intended only for Indonesian speakers.

# Miki bot

<img src="mikibot.svg">

Dokumentasi: [riozec.github.io/mikibot](https://riozec.github.io/mikibot)

&nbsp;

## Deskripsi

Program ini bertujuan untuk menggabungkan beberapa platform untuk chatbot, seperti Telegram, WhatsApp, atau bahkan web. Semua instansi bot di sini dapat berkomunikasi satu sama lain menggunakan protokol yang telah ditentukan.

&nbsp;

## Cara Kerja

Cara program ini bekerja adalah dengan menggunakan komunikasi antarproses (IPC). Pertama-tama, `main.js` akan menjalankan semua file yang ada di folder `./main/subproses` (menggunakan `child_process.fork()`). Lalu subproses-subproses tadi akan berjalan sesuai dengan perannya masing-masing. Di sini, `main.js` hanya bertugas sebagai konfigurasi awal, penengah komunikasi antar subproses dan membangkitkan kembali subproses ketika terhenti karena eror.

> Jantung:  
> `main.js`\
> Otak:\
> `perintah.js`\
> Memori:\
> `database.js`\
> Indera & anggota gerak:\
> `telegram.js`\
> `whatsapp.js`\
> \
> 😀

&nbsp;

## Kamus

-   `PR = perintah.js`
-   `DB = database.js`
-   `WA = whatsapp.js`
-   `TG = telegram.js`

&nbsp;

## Requirements

-   nodejs
-   ffmpeg
-   imagemagick
-   webpmux

&nbsp;

## Run

```
node ./main/main.js [...argumen]
```

Argumen-argumen:

-   `--s=[bot1],[bot2],[bot3]`\
    Bot yang akan dijalankan.
-   `--deflang=[LANGCODE]`\
    Mengatur kode bahasa default pada pengguna yang belum mengatur bahasa.
-   `--dev`\
    Mengaktifkan mode pengembangan/debug.
-   `--watch`\
    Mengaktifkan mode muat ulang setelah file berubah.
-   `--dbtest`\
    Menggunakan database testing.
-   `--devids=[ID1],[ID2],[ID3]`\
    ID pengembang dari masing-masing platform (seperti nomor telepon WA). Digunakan untuk mengidentifikasi dan menjalankan perintah khusus pengembang bot.
-   `--mongodburi=[URI]` \*\
    URI koneksi ke MongoDB Atlas.
-   `--tgtoken=[TOKEN BOT TELEGRAM]` \*\
    Token bot Telegram dari BotFather untuk mengaktifkan bot Telegram.

&nbsp;

## Komunikasi Antar-Proses

Ada 2 mekanisme utama dalam komunikasi antar-proses.

-   `sinyal` adalah ketika sebuah proses mengirim ke proses lain dengan tidak mengharapkan respon dari proses tersebut.
-   `kueri` adalah ketika sebuah proses mengirim ke proses lain dan proses tersebut harus merespon kembali dengan membawa hasil dari kueri yang diberikan.

Anda dapat mengirim dan menerima pesan dengan menggunakan kelas `IPC` di modul `utils.js`.

Ciri-ciri dari sebuah pesan kueri yaitu terdapat key `i` (ID) di dalamnya. Ini bertujuan untuk membedakan pesan yang berupa respon dari proses yang diberikan kueri. Oleh karena itu, proses yang diberikan kueri harus mengirimkan kembali ID yang sama (namun dalam key `ir` [ID respon]). Jika tidak, proses yang mengirimkan kueri akan menunggu selamanya dan menambah beban pada memori!

> Untuk mengirimkan kode untuk dieksekusi pada proses lainnya, masukkan kode ke dalam key `_eval` di dalam pesan yang akan di kirim (hanya bekerja pada pesan kueri).

&nbsp;

## ID Pengguna dan ID Chat

Setiap pengguna dan chat dari semua platform akan diberikan ID dengan bentuk yang sama. Hal ini memungkinkan agar semua pengguna maupun chat dapat disimpan dalam satu database yang sama.

Format ID Pengguna: `[platform]#[ID]`

Format ID Chat: `[platform]#[ID]#C`

> Platform adalah singkatan 2 huruf dari nama platform (lihat #Kamus).

> ID adalah ID dari masing-masing platform. Seperti nomor telepon di WA.

&nbsp;

## Database

Database yang digunakan adalah MongoDB Atlas. Semua data disimpan dalam satu koleksi (collection).

Ada 4 operasi utama dalam mengakses database:

-   Create/insert
    ```
    IPC.kirimKueri('DB', {
        c: {data} | {data}[]
    });
    ```
-   Read/find
    ```
    IPC.kirimKueri('DB', {
        r: {filter},
        m: true|false // many
    });
    ```
-   Update
    ```
    IPC.kirimKueri('DB', {
        u: [{filter}, {data}],
        m: true|false // many
    });
    ```
-   Delete
    ```
    IPC.kirimKueri('DB', { d: {filter}, m: true|false // many });
    ```

> Note: Urutan data di cache dapat berbeda dengan data di server. Pastikan gunakan `_id` untuk memfilter satu dokumen (document).

&nbsp;

## About

Start date: December 28th, 2021.\
Launch date: <s>Soon.</s> <b>Never</b>
