import { Client, ConnectConfig } from 'ssh2';
import net from 'net';
import { ENV } from '../config/env';

export interface SshTunnelConfig {
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshKeyPath?: string;
  remoteHost?: string;
  remotePort?: number;
  localPort?: number;
}

export class SshTunnelManager {
  private sshClient: Client | null = null;
  private localServer: net.Server | null = null;
  private isActive = false;
  private isConnecting = false;
  private localPort = 5433;
  private activeSockets = new Set<net.Socket>();

  /**
   * Cek apakah SSH Tunnel sedang aktif
   */
  public isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Dapatkan port lokal yang sedang digunakan untuk forwarding
   */
  public getLocalPort(): number {
    return this.localPort;
  }

  /**
   * Menjalankan SSH Tunnel untuk port forwarding ke database PostgreSQL remote
   */
  public async start(config?: SshTunnelConfig): Promise<{ localPort: number }> {
    if (this.isActive && this.localServer) {
      return { localPort: this.localPort };
    }

    if (this.isConnecting) {
      // Tunggu hingga proses koneksi yang sedang berjalan selesai
      while (this.isConnecting) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.isActive) {
        return { localPort: this.localPort };
      }
    }

    this.isConnecting = true;

    let sshHost = (config?.sshHost || ENV.SSH_HOST || '').trim();
    let sshUser = (config?.sshUser || ENV.SSH_USER || '').trim();
    let sshPort = config?.sshPort || ENV.SSH_PORT || 22;

    // Otomatis ekstrak jika format SSH_HOST berupa "user@host" atau "user@host:port"
    if (sshHost.includes('@')) {
      const atParts = sshHost.split('@');
      sshUser = sshUser || atParts[0];
      sshHost = atParts[1];
    }
    if (sshHost.includes(':')) {
      const colonParts = sshHost.split(':');
      sshHost = colonParts[0];
      sshPort = Number(colonParts[1]) || sshPort;
    }

    const sshPassword = config?.sshPassword || ENV.SSH_PASSWORD;
    let remoteHost = config?.remoteHost || ENV.DB_HOST || '127.0.0.1';
    // Jika remoteHost disetel sama dengan IP server, gunakan 127.0.0.1 dari sisi server
    if (remoteHost === sshHost) {
      remoteHost = '127.0.0.1';
    }

    const remotePort = config?.remotePort || ENV.DB_PORT || 5432;
    this.localPort = config?.localPort || ENV.DB_LOCAL_PORT || 5433;

    if (!sshHost || !sshUser) {
      this.isConnecting = false;
      throw new Error(
        'SSH_HOST dan SSH_USER belum dikonfigurasi di berkas .env untuk mengaktifkan SSH Tunnel.'
      );
    }

    return new Promise((resolve, reject) => {
      console.log(`\n🔒 [SSH Tunnel] Menghubungkan ke SSH Server ${sshUser}@${sshHost}:${sshPort}...`);

      const ssh = new Client();
      this.sshClient = ssh;

      const connectConfig: ConnectConfig = {
        host: sshHost,
        port: sshPort,
        username: sshUser,
        password: sshPassword,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 30000,
      };

      ssh.on('ready', () => {
        console.log('✅ [SSH Tunnel] Terautentikasi ke SSH Server. Menyiapkan local port forwarding...');

        const server = net.createServer((socket) => {
          this.activeSockets.add(socket);

          socket.on('close', () => {
            this.activeSockets.delete(socket);
          });

          socket.on('error', (err) => {
            console.warn('⚠️ [SSH Tunnel] Socket client error:', err.message);
            this.activeSockets.delete(socket);
          });

          // Forward traffic dari port lokal ke remote database melalui SSH channel
          ssh.forwardOut(
            '127.0.0.1',
            socket.remotePort || 0,
            remoteHost,
            remotePort,
            (err, stream) => {
              if (err) {
                console.error(`❌ [SSH Tunnel] Gagal meneruskan koneksi ke ${remoteHost}:${remotePort}:`, err.message);
                socket.end();
                return;
              }

              // Pipe data dua arah (Local Socket <-> SSH Stream <-> Remote DB)
              socket.pipe(stream);
              stream.pipe(socket);

              stream.on('error', (streamErr: any) => {
                console.warn('⚠️ [SSH Tunnel] Stream forward error:', streamErr?.message || streamErr);
                socket.end();
              });

              stream.on('close', () => {
                socket.end();
              });
            }
          );
        });

        server.on('error', (serverErr: any) => {
          this.isConnecting = false;
          if (serverErr.code === 'EADDRINUSE') {
            console.warn(`⚠️ [SSH Tunnel] Port lokal ${this.localPort} sedang digunakan. Menggunakan tunnel yang sudah aktif.`);
            this.isActive = true;
            resolve({ localPort: this.localPort });
          } else {
            console.error('❌ [SSH Tunnel] Server lokal error:', serverErr);
            reject(serverErr);
          }
        });

        server.listen(this.localPort, '127.0.0.1', () => {
          this.isActive = true;
          this.isConnecting = false;
          this.localServer = server;
          console.log(
            `🚀 [SSH Tunnel] Tunnel aktif! 127.0.0.1:${this.localPort} ➡️  [SSH: ${sshHost}] ➡️  ${remoteHost}:${remotePort}`
          );
          resolve({ localPort: this.localPort });
        });
      });

      ssh.on('error', (err) => {
        this.isConnecting = false;
        this.isActive = false;
        console.error('❌ [SSH Tunnel] Koneksi SSH error:', err.message);
        reject(err);
      });

      ssh.on('close', () => {
        console.warn('⚠️ [SSH Tunnel] Koneksi SSH terputus.');
        this.isActive = false;
        this.isConnecting = false;
        this.cleanupSockets();
      });

      try {
        ssh.connect(connectConfig);
      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  private cleanupSockets(): void {
    for (const socket of this.activeSockets) {
      try {
        socket.destroy();
      } catch (e) {}
    }
    this.activeSockets.clear();
  }

  /**
   * Menghentikan SSH Tunnel dan membersihkan resource
   */
  public async stop(): Promise<void> {
    this.cleanupSockets();

    if (this.localServer) {
      await new Promise<void>((resolve) => {
        this.localServer?.close(() => resolve());
      });
      this.localServer = null;
    }

    if (this.sshClient) {
      try {
        this.sshClient.end();
      } catch (e) {}
      this.sshClient = null;
    }

    this.isActive = false;
    this.isConnecting = false;
    console.log('🛑 [SSH Tunnel] Tunnel berhasil dihentikan.');
  }
}

export const sshTunnel = new SshTunnelManager();
