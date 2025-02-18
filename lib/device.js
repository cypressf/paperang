import { getDeviceList, WebUSBDevice } from "usb";
import { unpack } from "./packet.js";

export const getDevice = async () => {
  const printer = getDeviceList().find(
    (device) =>
      device.deviceDescriptor.idVendor === 17224 &&
      device.deviceDescriptor.idProduct === 21892
  );

  if (!printer) {
    return {};
  }

  const device = await WebUSBDevice.createInstance(printer);

  if (!device) {
    return {};
  }

  await device.open();
  await device.selectConfiguration(1);
  await device.claimInterface(0);

  const transfer = async (
    /** @type {ArrayBuffer} */ data,
    { read = false } = {}
  ) => {
    const promise = device.transferOut(2, data);
    let ret;
    if (read) {
      let result = await device.transferIn(2, 8192);
      if (result.data) {
        ret = unpack(Buffer.from(result.data.buffer));
      }
    }
    let result = await promise;
    console.log(result);
    return ret;
  };

  return { device, transfer };
};
