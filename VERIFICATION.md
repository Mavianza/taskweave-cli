# Pemeriksaan aktual TaskWeave 1.0.0

Dijalankan pada **31 Oktober 2026**, Linux, Node.js **24.22.1**, npm **11.9.0**.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | **37/37 tes lulus**, 0 gagal, 0 skipped. |
| `npm run smoke` | **6/6 skenario CLI lulus**. |
| `node --check` untuk seluruh 15 berkas `.mjs` | Seluruh berkas lolos pemeriksaan sintaks. |
| `node bin/taskweave.mjs run examples/taskweave.json verify --jobs 2 --json` | Exit 0; 4/4 tugas berhasil. Demo menjalankan 3 tes kecil, menghasilkan artefak dengan `sum: 16`, dan memverifikasi SHA-256 source. |
| `npm pack --json --ignore-scripts --offline --pack-destination <temp>` | Tarball `taskweave-mini-cli-1.0.0.tgz` terbentuk; 20 berkas, tanpa output demo hasil eksekusi. |
| `npm install --global --prefix <temp>/prefix --ignore-scripts --offline --no-audit --no-fund <tarball>` | Instalasi ke prefix sementara berhasil. Perintah hasil instalasi mengeluarkan `TaskWeave 1.0.0`; plan valid dan pipeline demo 4/4 berhasil saat dipanggil dari luar folder source. |

Tes memakai proses anak nyata dan direktori sementara. Paralelisme dibuktikan dengan dua tugas yang harus melihat marker satu sama lain saat berjalan; batas jobs diperiksa dari event start/end. Tes lainnya memeriksa urutan dependensi, eksekusi shared dependency satu kali, target terpilih, gagal+skip, command tidak ditemukan, argumen shell sebagai literal, output melebihi batas, timeout, pembatalan, dan laporan yang tidak menimpa berkas lama.

Kasus POSIX mencakup penghentian turunan di process group, SIGTERM ke CLI, serta turunan yang sengaja melepaskan group namun masih menahan pipe. Pada kasus terakhir, fixture dibersihkan oleh tes; runner harus tetap kembali setelah timeout. Pengiriman signal OS bersifat asinkron, sehingga tes penghentian turunan melakukan observasi berbatas sampai proses mati atau menjadi zombie yang menunggu reaping.

Smoke test menyalin pipeline demo ke direktori sementara. Enam skenarionya: plan tanpa eksekusi, pipeline build dan laporan JSON, kegagalan dengan skip serta cabang independen, timeout, penolakan siklus, dan perlindungan file laporan.

Persyaratan source adalah Node.js >=22. Hasil di atas tidak mengklaim pengujian pada Node.js 22, Windows, atau macOS. Tiga tes yang khusus process group/signal POSIX dilewati saat berjalan di Windows.
