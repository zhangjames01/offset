
import { loadEnvFile } from "node:process";
import { getPayPalOrder } from "../lib/paypal/client";

if (process.env.PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_SECRET) {
  throw new Error("Remove PayPal credentials from the shell first.");
}

loadEnvFile(".env.local");

if (process.env.PAYPAL_ENV !== "sandbox") {
  throw new Error("PayPal Sandbox is required.");
}

const orderIds = [
  "7S85255337434352A",
  "0P892320JL230133Y",
  "3RP45855WR0571453",
  "1W990360WV543333K",
  "48E17922WX375962Y",
  "49X35015BY7463451",
  "29068957BH431771T",
  "20R79600ND456000L",
  "995392131M3760044",
  "1WR25538R0709493H",
  "8FU85225MP982920P",
];

async function main() {
  for (const orderId of orderIds) {
    try {
      const result = await getPayPalOrder(orderId);

      console.log({
        orderId,
        status: result.status,
        captureId: result.captureId,
        captureStatus: result.captureStatus,
      });
    } catch (error) {
      console.error(
        `Failed to check ${orderId}:`,
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
