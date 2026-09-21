import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import path from 'path';
import pino from 'pino';
import { prisma } from '../database/prisma';

async function main() {
  const authFolder = path.resolve(process.cwd(), 'storage', 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  console.log('Connecting socket to query onWhatsApp for all users...');
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp! Querying users...');
      try {
        const users = await prisma.users.findMany({
          where: {
            deleted_at: null,
            phone_number: { not: '-' },
          },
        });

        console.log(`Found ${users.length} users in DB.`);
        for (const u of users) {
          const rawPhone = (u.phone_number || '').replace(/[^0-9]/g, '');
          if (rawPhone.length < 9) continue;
          let phone = rawPhone;
          if (phone.startsWith('08')) phone = '628' + phone.slice(2);

          try {
            const results = await sock.onWhatsApp(phone);
            console.log(`\nQuery: ${u.name} (${phone}):`, results);
            if (results && results.length > 0) {
              const res = results[0];
              const lid = (res as any).lid ? String((res as any).lid).split('@')[0] : null;
              if (lid && lid !== u.device_id) {
                await prisma.users.update({
                  where: { id: u.id },
                  data: {
                    device_id: lid,
                    updated_at: new Date(),
                  },
                });
                console.log(`🎉 [UPDATED] ${u.name} (ID: ${u.id}) LID set to: ${lid}`);
              }
            }
          } catch (qErr) {
            console.warn(`Query failed for ${u.name}:`, qErr);
          }
        }
      } catch (err) {
        console.error('Error in syncLids:', err);
      } finally {
        setTimeout(() => {
          sock.end(undefined);
          prisma.$disconnect().then(() => process.exit(0));
        }, 3000);
      }
    } else if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      console.log('Connection closed, status:', statusCode);
    }
  });
}

main().catch(console.error);
