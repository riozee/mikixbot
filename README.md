# Miki bot

## Deskripsi

Program ini bertujuan untuk menggabungkan beberapa platform untuk chatbot, seperti Telegram, WhatsApp, atau bahkan web. Semua instansi bot di sini dapat berkomunikasi satu sama lain menggunakan protokol yang telah ditentukan.

Cara program ini bekerja adalah dengan menggunakan komunikasi antarproses (IPC). Pertama-tama, `main.js` akan menjalankan semua file yang ada di folder `./main/subproses` (menggunakan `child_process.fork()`). Lalu subproses-subproses tadi akan berjalan sesuai dengan perannya masing-masing. Di sini, `main.js` hanya bertugas sebagai konfigurasi awal, penengah komunikasi antar subproses dan membangkitkan kembali subproses ketika terhenti karena eror.

> Jantung:  
> `main.js`\
> Otak:\
> `perintah.js`\
> Memori:\
> `database.js`\
> Indera & anggota gerak:\
> `web.js`\
> `telegram.js`\
> `whatsapp.js`\
> \
> 😀

&nbsp;

> CATATAN: Utamakan menggunakan Bahasa Indonesia dalam penulisan kode.\
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kenapa? Karena saya gabut.

&nbsp;

## Kamus

-   `PR = perintah.js`
-   `DB = database.js`
-   `WA = whatsapp.js`
-   `TG = telegram.js`

&nbsp;

## Run

```
node ./main/main.js [...argumen]
```

Argumen-argumen:

-   `--s=[subproses1],[subproses2],[subproses3]`\
    Subproses yang akan dijalankan (`perintah.js` dan `database.js` dijalankan secara otomatis).
-   `--deflang=[LANGCODE]`\
    Mengatur kode bahasa default pada pengguna yang belum mengatur bahasa.
-   `--dev`\
    Mengaktifkan mode pengembangan/debug.
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

## Format Pesan

Pesan teks:

-   `teks: [string]`

Pesan lainnya

-   [TODO]

&nbsp;

## Database

Database yang digunakan adalah MongoDB Atlas.

Anda harus mengirimkan kueri ke `DB` (database) untuk mengakses database. Format pesan yang dikirimkan adalah:

-   `koleksi` = koleksi (collection) database yang akan diakses
-   `aksi` = aksi (action) yang akan dijalankan pada database

> &nbsp;\
> Contoh untuk kueri:
>
> ```
> client.db().collection('users').find({_id: id}).toArray();
> ```
>
> adalah:
>
> ```
> IPC.kirimKueri('DB', {
>    koleksi: 'users',
>    aksi: [ ['find', {_id: id}], 'toArray' ]
> });
> ```
>
> &nbsp;

&nbsp;

## Format dokumen pada koleksi "users"

-   `_id: [ID Pengguna]` \*
-   `hit: [int]` (jumlah perintah/command dijalankan)
-   `bnd: [boolean]` (status banned/blokir)
-   `lng: [string]` (kode bahasa default)
-   `rgd: [timestamp]` (waktu pertama terdaftar)
-   `usn: [string]` (username)

&nbsp;

## Format dokumen pada koleksi "chats"

[TODO]

&nbsp;

## About

Start date: December 28th, 2021.\
Launch date: Later.
