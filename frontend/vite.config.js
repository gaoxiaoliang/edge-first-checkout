import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import os from 'os'

function getLocalIp() {
    const interfaces = os.networkInterfaces()

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address
            }
        }
    }

    return '127.0.0.1'
}

const localIp = getLocalIp()
const mobileCheckoutBase = `http://${localIp}:8000`
console.log('Mobile checkout base:', mobileCheckoutBase)

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
    define: {
'import.meta.env.VITE_MOBILE_CHECKOUT_BASE': JSON.stringify(mobileCheckoutBase)
}
}
)
