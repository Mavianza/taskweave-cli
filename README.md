# TaskWeave

Task runner kecil untuk mengotomatisasi urutan kerja proyek. Definisikan perintah dan dependensinya sekali dalam JSON; TaskWeave menjalankan tugas yang siap, membatasi jumlah proses paralel, dan mencatat hasilnya. Cocok untuk rangkaian pemeriksaan sintaks → tes → build → verifikasi artefak pada tugas kuliah atau proyek pribadi.

Proyek harian **31 Oktober 2026**, dibuat dengan JavaScript dan modul bawaan Node.js. Tidak memerlukan paket runtime eksternal.

## Fitur

- Graph dependensi diperiksa sebelum eksekusi: target/dependensi hilang, siklus, typo kolom, dan definisi yang tidak valid ditolak.
- Target opsional: jalankan satu atau beberapa tugas beserta seluruh dependensinya. Dependensi bersama hanya dijalankan sekali.
- Eksekusi paralel dengan `--jobs`, default 2, maksimal 32.
- Timeout per tugas; default 30 detik. Dependensi gagal/timeout menyebabkan tugas turunannya dilewati, sedangkan tugas independen tetap berjalan.
- Pembatalan melalui Ctrl+C/SIGINT atau SIGTERM, dengan laporan status tugas yang sudah atau belum berjalan.
- Capture stdout/stderr, kode keluar, durasi, dan status dalam teks atau JSON.
- Perintah `plan` untuk memeriksa urutan tanpa menjalankan perintah konfigurasi.
- Berkas laporan yang sudah ada dilindungi dari penimpaan.
- Pipeline demo lengkap dan tes otomatis tanpa mengunduh dependensi.

## Instalasi dan mulai mencoba

Gunakan **Node.js 22 atau lebih baru**. Ekstrak arsip atau clone repository, lalu buka folder proyek. `npm install` tidak diperlukan untuk menjalankan source.

```sh
node bin/taskweave.mjs --version
node bin/taskweave.mjs plan examples/taskweave.json verify
node bin/taskweave.mjs run examples/taskweave.json verify --jobs 2
```

Alternatif melalui npm yang sudah terpasang bersama Node.js:

```sh
npm run demo
```

Pipeline contoh menjalankan empat tugas: `syntax` dan `test` boleh paralel; `build` menunggu keduanya; `verify` menunggu `build`. Demo menghasilkan `examples/demo/output/result.json`, berisi hasil penjumlahan `16` dan SHA-256 source yang kemudian diperiksa ulang. Demo dapat dijalankan kembali; hanya artefak contoh di folder `output` yang diperbarui.

Contoh bagian keluaran; durasi dapat berbeda:

```text
Hasil: success; 447 ms; batas paralel 2
syntax: success (108 ms, exit 0)
test: success (252 ms, exit 0)
build: success (93 ms, exit 0)
  stdout: Build selesai: output/result.json
verify: success (93 ms, exit 0)
  stdout: Artefak build valid: sum=16 dan SHA-256 source cocok.
```

## Menulis konfigurasi sendiri

Berkas JSON berisi `version: 1` dan objek `tasks`. Contoh minimal:

```json
{
  "version": 1,
  "tasks": {
    "check": {
      "command": ["@node", "--check", "app.mjs"],
      "timeoutMs": 10000
    },
    "test": {
      "command": ["@node", "--test", "app.test.mjs"],
      "dependsOn": ["check"]
    }
  }
}
```

Sesuaikan nama berkas tersebut dengan proyek yang diperiksa. Untuk contoh yang langsung siap jalan, gunakan `examples/taskweave.json`.

| Kolom tugas | Isi |
| --- | --- |
| `command` | Wajib: array executable dan argumen. Alias `@node` pada elemen pertama memakai executable Node.js yang sedang menjalankan TaskWeave. |
| `dependsOn` | Opsional: array nama tugas unik; default `[]`. |
| `timeoutMs` | Opsional: integer 1–3.600.000 milidetik; default 30.000. |
| `cwd` | Opsional: direktori kerja; default folder konfigurasi. Path relatif dihitung dari lokasi konfigurasi, bukan lokasi terminal. |

Nama tugas harus diawali huruf kecil dan hanya berisi huruf kecil, angka, `_`, atau `-`, maksimal 48 karakter. Batasnya 100 tugas, 256 argumen per command, dan konfigurasi 256 KiB. Berkas dibaca sebagai UTF-8; BOM didukung. Seluruh graph dan direktori kerja divalidasi, termasuk cabang yang tidak dipilih.

Command dijalankan sebagai proses nyata dengan environment terminal, stdin tertutup, dan `shell: false`. Argumen seperti `*`, `&&`, `$VAR`, dan `$(...)` diteruskan sebagai teks biasa. `command` harus array, bukan string command shell. Untuk Python, misalnya, gunakan `["python", "-m", "unittest", "discover", "-s", "tests"]` bila executable tersebut tersedia.

Pada Windows, executable `.cmd`/`.bat` seperti `npm.cmd` memerlukan interpreter yang disebut secara eksplisit, misalnya `["cmd.exe", "/d", "/c", "npm", "test"]`. Pada perintah itu, `cmd.exe` sendiri yang menerapkan aturan shell. TaskWeave tidak menambahkan shell secara otomatis. Alias `@node` pada demo menghindari kebutuhan tersebut.

## Target dan laporan

```sh
node bin/taskweave.mjs run examples/taskweave.json build --jobs 1
node bin/taskweave.mjs run examples/taskweave.json verify --report taskweave-report.json
node bin/taskweave.mjs run examples/taskweave.json verify --json
```

Tanpa target, semua tugas disertakan. Beberapa target dapat ditulis setelah path konfigurasi. `plan` menampilkan urutan topologis yang deterministik; pada mode paralel, waktu mulai/selesai aktual mengikuti dependensi dan ketersediaan slot.

`--report` menulis JSON ke path relatif terminal. Direktori induk harus sudah ada. Tujuan yang sudah ada ditolak sebelum task berjalan; bila tujuan dibuat oleh proses lain saat eksekusi, file itu tetap tidak ditimpa dan penulisan laporan gagal. Pilih nama laporan baru untuk setiap eksekusi.

`--json` membuat stdout berisi satu objek JSON. Keluaran command tersimpan di dalam objek tersebut. Kesalahan penggunaan opsi oleh parser tetap ditulis ke stderr. Laporan `schemaVersion: 1` berisi status keseluruhan, jumlah per status, durasi, dan daftar tugas dalam urutan topologis. Setiap tugas menyertakan status, command, cwd, dependensi, waktu, exit code/signal, alasan kegagalan/skip bila ada, stdout, serta stderr.

Status tugas: `success`, `failed`, `timeout`, `cancelled`, dan `skipped`. `skipped` berarti tugas tidak dijalankan karena dependensinya gagal atau karena pembatalan. Output ditampung sampai tugas selesai, maksimal 64 KiB pertama per stream; output yang lebih panjang diberi flag `stdoutTruncated`/`stderrTruncated`. Timeout/pembatalan dapat menghasilkan output parsial.

| Exit code TaskWeave | Arti |
| --- | --- |
| `0` | Plan valid atau seluruh tugas berhasil. |
| `1` | Ada tugas gagal/timeout atau tugas yang dilewati karena kegagalan dependensi. |
| `2` | Konfigurasi, opsi, input, atau penulisan laporan bermasalah. |
| `130` / `143` | Eksekusi dibatalkan melalui SIGINT / SIGTERM. |

## Batasan lingkup

TaskWeave ditujukan untuk command foreground dengan durasi terbatas. Tidak ada cache, retry otomatis, remote execution, atau penjadwalan jam tertentu. Pada POSIX, penghentian menyasar process group milik tugas. Pada Windows, penghentian memakai `taskkill /T /F` dan bersifat upaya terbaik, terutama bila parent lebih dulu keluar. Proses yang sengaja melepaskan diri dari group/session tidak dijamin ikut dihentikan. Pipe pembaca tetap ditutup saat timeout agar runner tidak menunggu output turunan tanpa batas.

Konfigurasi berisi perintah yang benar-benar dijalankan; gunakan konfigurasi proyek yang dipercaya. `plan` tidak mengeksekusi command konfigurasi. Laporan memuat command dan output apa adanya; isinya mengikuti program yang dijalankan.

## Pengujian

```sh
npm test
npm run smoke
```

Tes menggunakan proses lokal nyata dan direktori sementara: urutan dependensi, paralelisme, batas jobs, shared dependency, penolakan siklus sebelum eksekusi, nonzero exit, timeout, pembatalan, output besar, argumen literal, serta perlindungan laporan. Hasil yang benar-benar dijalankan tercatat di [VERIFICATION.md](VERIFICATION.md).

Instalasi lokal sebagai perintah `taskweave` juga dapat dilakukan dengan `npm install --global .`; source tetap dapat dijalankan langsung memakai `node` seperti contoh di atas. Lisensi MIT.
