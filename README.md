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

## Run

```
node ./main/main.js [...argumen]
```

Argumen-argumen:

-   `--deflang=[KODE BAHASA DEFAULT]`
-   `--dev` (dev mode)
-   `--devids=[ID1],[ID2],[ID3]`
-   `--mongodburi=[URI]` \*
-   `--tgtoken=[TOKEN BOT TELEGRAM]` \*

&nbsp;

## Pesan masuk

> Semua pesan masuk dari platform yang berbeda-beda harus mengirimkan kembali pesan dengan format yang telah ditentukan agar dapat diproses secara sama oleh `perintah.js`. Begitu juga dengan semua bentuk komunikasi antar proses di dalam program ini. Semuanya harus saling memahami karena program ini dibuat dengan arsitektur proses yang berbeda-beda.

Format pesan masuk:

-   `dari: [ID Pengguna] | [ID Chat]` \*
-   \<Pesan\> \*

Format pesan keluar:

-   `ke: [ID Pengguna] | [ID Chat]` \*
-   \<Pesan\> \*

> Format `[ID Pengguna]` adalah `"[Platform]-[ID]"`.
>
> > Contoh `[ID Pengguna]` salah satu pengguna Telegram:\
> > TG-12345678.
>
> Format `[ID Chat]` adalah `"C-[Platform]-[ID]"`.
>
> > Contoh `[ID Chat]` salah satu grup di WhatsApp:\
> > C-WA-6287765432109-1612345678.

> `Platform` adalah 2 huruf singkatan dari nama platform, misalnya TG untuk Telegram atau WA untuk WhatsApp. Kecuali untuk web, yaitu menggunakan 3 huruf: WEB.

> `ID` adalah nomor ID pengguna dari masing-masing platform, seperti nomor telepon di WhatsApp.

## \<Pesan\>

Pesan teks:

-   `teks: [string]`

Pesan lainnya

-   [TODO]

&nbsp;

## Database

> Database yang digunakan adalah MongoDB Atlas.

Format kueri database:

-   `i: T[idDB]` \*
-   `k: [koleksi]` \*
-   `_: Array<[metode, ...argumen]>` \*

Format respon dari database:

-   `i: [idDB]` \*
-   `h: [hasil kueri]`
-   `e: [eror]`

> Format `[idDB]` adalah `"DB-[rand(0,9)][i++]-[subproses]"`.

> `subproses` adalah 2 huruf singkatan dari nama file subproses darimana kueri tersebut dikirimkan. Misalnya jika kueri dikirimkan dari `perintah.js`, `idDB`-nya adalah:\
> DB12-PR

> Isi dari `_` adalah metode yang akan dipanggil pada `klien.db().collection(koleksi)`.
>
> > Contoh isi `_` untuk kueri berupa:\
> > `find({_id: pengirim}).toArray()`\
> > adalah:\
> > `[["find", {_id: pengirim}], "toArray"]`

&nbsp;

## \<User\> (koleksi: users)

-   `_id: [ID Pengguna]` \*
-   `hit: [int]` (jumlah perintah/command dijalankan)
-   `bnd: [boolean]` (status banned/blokir)
-   `lng: [string]` (kode bahasa default)
-   `rgd: [timestamp]` (waktu pertama terdaftar)
-   `usn: [string]` (username)

&nbsp;

## \<Chat\> (koleksi: chats)

[TODO]

&nbsp;

## About

Start date: December 28th, 2021.\
Launch date: Later.
