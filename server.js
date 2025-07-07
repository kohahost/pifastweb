const express = require('express');
const path = require('path');
const fs = require('fs');
const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');

const app = express();
app.use(express.static('public'));
app.use(express.json());

const CONFIG_FILE = path.join(__dirname, 'config.json');

async function getKeypairFromMnemonic(mnemonic) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
  const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
  return {
    keypair,
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret()
  };
}

async function startFastBotFromConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const { mnemonic, receiver, startTime } = config;
  const { keypair, publicKey } = await getKeypairFromMnemonic(mnemonic);
  const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

  const targetDate = new Date(startTime);
  const now = new Date();
  const delay = targetDate.getTime() - now.getTime();

  if (delay > 0) {
    console.log(`⏳ Menunggu hingga ${targetDate.toLocaleString('id-ID')}...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  console.log("🚀 Menjalankan bot sekarang...");

  while (true) {
    try {
      const account = await server.loadAccount(publicKey);
      const claimables = await server.claimableBalances().claimant(publicKey).call();

      if (claimables.records.length > 0) {
        for (let cb of claimables.records) {
          const tx = new StellarSdk.TransactionBuilder(account, {
            fee: (await server.fetchBaseFee()).toString(),
            networkPassphrase: 'Pi Network'
          })
            .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: cb.id }))
            .setTimeout(30)
            .build();

          tx.sign(keypair);
          const res = await server.submitTransaction(tx);
          console.log(`✅ Klaim: ${cb.id} — ${res.hash}`);
        }
      }

      const accInfo = await axios.get(`https://api.mainnet.minepi.com/accounts/${publicKey}`);
      const balance = parseFloat(
        accInfo.data.balances.find(b => b.asset_type === 'native')?.balance || "0"
      );

      if (balance > 0.01) {
        const amount = balance - 0.01;
        const reload = await server.loadAccount(publicKey);

        const tx = new StellarSdk.TransactionBuilder(reload, {
          fee: (await server.fetchBaseFee()).toString(),
          networkPassphrase: 'Pi Network'
        })
          .addOperation(StellarSdk.Operation.payment({
            destination: receiver,
            asset: StellarSdk.Asset.native(),
            amount: amount.toFixed(7)
          }))
          .setTimeout(30)
          .build();

        tx.sign(keypair);
        const result = await server.submitTransaction(tx);
        console.log(`📤 Transfer: ${amount.toFixed(7)} Pi — ${result.hash}`);
      } else {
        console.log("⏳ Saldo belum cukup.");
      }

    } catch (err) {
      console.error("❌ Error:", err.response?.data?.extras?.result_codes || err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

app.get('/get-config', (req, res) => {
  const config = fs.readFileSync(CONFIG_FILE, 'utf8');
  res.json(JSON.parse(config));
});

app.post('/save-config', (req, res) => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
  res.send('✅ Konfigurasi disimpan.');
});

app.get('/start-bot', async (req, res) => {
  res.send('🚀 Bot akan dijalankan di latar...');
  startFastBotFromConfig();
});

app.listen(3000, () => {
  console.log("🌐 Web Bot aktif di http://localhost:1000");
});
