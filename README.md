# mikixbot

```
node ./main/main.js
```

-   Argumen:

```
--dev
--devids=[ID1],[ID2],[ID3]
--mongodburi=[URI]
--tgtoken=[TELEGRAM TOKEN]
```

-   Format pesan masuk:

```
{
    pengirim: [id],
    chat?: [chat id]
}
```

-   Format pesan keluar:

```
{
    penerima: [id],
    chat?: [chat id],
}
```

'chat' hanya muncul di percakapan grup.

-   Format pesan

    -   Pesan teks
        ```
        {
            teks: [string]
        }
        ```

-   Bentuk data pengguna:

```
{
    "WA-6287722713834": {
        "hit": [int (command count)],
        "bnd": [bool (banned)],
    }
}
```
