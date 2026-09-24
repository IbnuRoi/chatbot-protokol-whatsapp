# Direktori Penyimpanan Berkas Surat (Upload Storage)

Folder ini digunakan oleh Chatbot WhatsApp Protokol Kemnaker untuk menyimpan berkas PDF surat masuk yang diunggah oleh pengguna.

## Symlink ke Server Production
Pada server deployment (Linux), folder ini dapat langsung di-*symlink* ke folder penyimpanan berkas aplikasi web utama:

```bash
# Contoh membuat symlink di server Linux:
ln -s /path/ke/aplikasi/storage/app/public/files/letter ./storage/letters
```

File yang disimpan di sini akan langsung sinkron dengan folder tujuan symlink tanpa perlu konfigurasi tambahan.
