// packages/core/src/lib.rs

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::{to_value, from_value};
use raptorq::{Encoder, Decoder, EncodingPacket, ObjectTransmissionInformation};
use log::info;
use console_error_panic_hook;

#[wasm_bindgen(start)]
pub fn __init() {
    console_error_panic_hook::set_once();
    log::set_max_level(log::Level::Info.to_level_filter());
    info!("Mycelium core (FEC Engine) initialized");
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EncodeResult {
    pub oti: ObjectTransmissionInformation,
    pub packets: Vec<EncodingPacket>,
}

#[wasm_bindgen]
pub fn encode(data: &[u8]) -> Result<JsValue, JsValue> {
    if data.is_empty() {
        return Err(JsValue::from_str("Input data cannot be empty"));
    }
    let oti = ObjectTransmissionInformation::with_defaults(data.len() as u64, 1024);
    let encoder = Encoder::new(data, oti.clone());
    let transfer = oti.transfer_length();
    let sym_sz   = oti.symbol_size() as u64;
    let k = ((transfer + sym_sz - 1) / sym_sz) as u32;
    let to_generate = k.checked_mul(2).unwrap_or(u32::MAX);
    let packets: Vec<EncodingPacket> = encoder.get_encoded_packets(to_generate);
    let result = EncodeResult { oti, packets };
    to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn decode(bundle_js: JsValue) -> Result<Vec<u8>, JsValue> {
    let bundle: EncodeResult = from_value(bundle_js)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut decoder = Decoder::new(bundle.oti.clone());
    let k = ((bundle.oti.transfer_length() + bundle.oti.symbol_size() as u64 - 1) / bundle.oti.symbol_size() as u64) as usize;
    let provided = bundle.packets.len();

    for packet in bundle.packets {
        if let Some(data) = decoder.decode(packet) {
            return Ok(data);
        }
    }

    Err(JsValue::from_str(&format!(
        "Decoding failed: provided {} packets, but need at least {} to reconstruct.",
        provided, k
    )))
}