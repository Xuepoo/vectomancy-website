use serde::{Deserialize, Serialize};
use std::panic;
use wasm_bindgen::prelude::*;

use vectomancy::math;
use vectomancy::models::{self, MathExpressionAST};
use vectomancy::parser::parse_memory;

#[derive(Deserialize)]
pub struct ProcessOptions {
    pub format: String,
    pub color: bool,
    pub mode: String,
    pub chaikin_iters: usize,
    pub terms: usize,
    pub detail: usize,
    pub min_path_len: usize,
    #[serde(default)]
    pub color_style: Option<models::ColorStyle>,
    #[serde(default)]
    pub letter_spacing: Option<f32>,
    #[serde(default)]
    pub simplify_math: Option<bool>,
    #[serde(default)]
    pub fourier_adaptive: Option<bool>,
    #[serde(default)]
    pub fourier_energy_threshold: Option<f64>,
}

#[derive(Serialize)]
struct WasmOutput {
    ast: MathExpressionAST,
    width: u32,
    height: u32,
}

#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

fn build_ast(output: models::ParserOutput, opts: &ProcessOptions) -> Result<WasmOutput, JsValue> {
    let tolerance = {
        let detail_clamped = opts.detail.clamp(1, 100) as f64;
        5.0 * (1.0 - (detail_clamped / 100.0)).powi(2) + 0.1
    };
    let min_path_len = opts.min_path_len;
    let mode = opts.mode.to_lowercase();

    let (ast, original_dimensions) = match output {
        models::ParserOutput::Paths {
            paths,
            original_dimensions,
        } => {
            let bbox = math::compute_bounding_box(&paths);
            let ast = match mode.as_str() {
                "fourier" => {
                    let mut valid_paths = Vec::new();
                    let mut valid_colors = Vec::new();
                    for path in paths {
                        if path.data.len() < min_path_len {
                            continue;
                        }
                        let reduced = math::simplify_rdp(&path.data, tolerance);
                        if reduced.len() > 3 {
                            valid_paths.push(reduced);
                            valid_colors.push(path.color_style.clone());
                        }
                    }

                    let path_refs: Vec<&[models::Point2D]> =
                        valid_paths.iter().map(|p| p.as_slice()).collect();

                    // GPU is disabled in WASM, pass false
                    let fourier_adaptive = opts.fourier_adaptive.unwrap_or(true);
                    let fourier_energy = opts.fourier_energy_threshold.unwrap_or(0.995);
                    let batch_results = math::perform_fft_batch(
                        &path_refs,
                        opts.terms,
                        false,
                        fourier_adaptive,
                        fourier_energy,
                    )
                    .map_err(|e| JsValue::from_str(&format!("FFT error: {}", e)))?;

                    let mut strokes = Vec::new();
                    for (terms, color) in batch_results.into_iter().zip(valid_colors) {
                        strokes.push(models::ColoredPath {
                            color_style: color,
                            data: terms,
                        });
                    }
                    MathExpressionAST::Fourier {
                        strokes,
                        bounding_box: bbox,
                    }
                }
                "spline" => {
                    let all_equations: Vec<_> = paths
                        .into_iter()
                        .filter_map(|path| {
                            if path.data.len() < min_path_len {
                                return None;
                            }
                            let reduced = math::simplify_rdp(&path.data, tolerance);
                            if reduced.len() > 2 {
                                let segments = math::spline::fit_cubic_bezier(&reduced);
                                let equations = math::spline::build_splines(
                                    &segments,
                                    opts.simplify_math.unwrap_or(true),
                                );
                                Some(models::ColoredPath {
                                    color_style: path.color_style.clone(),
                                    data: equations,
                                })
                            } else {
                                None
                            }
                        })
                        .collect();
                    MathExpressionAST::Spline {
                        equations: all_equations,
                        bounding_box: bbox,
                    }
                }
                _ => {
                    // chaikin default
                    let smoothed_paths: Vec<_> = paths
                        .into_iter()
                        .filter_map(|path| {
                            if path.data.len() < min_path_len {
                                return None;
                            }
                            let reduced = math::simplify_rdp(&path.data, tolerance);
                            let smoothed = if opts.chaikin_iters > 0 {
                                math::chaikin_smooth(&reduced, opts.chaikin_iters)
                            } else {
                                reduced
                            };
                            Some(models::ColoredPath {
                                color_style: path.color_style.clone(),
                                data: smoothed,
                            })
                        })
                        .collect();
                    MathExpressionAST::Polyline {
                        paths: smoothed_paths,
                        bounding_box: bbox,
                    }
                }
            };
            (ast, original_dimensions)
        }
        models::ParserOutput::Segments {
            segments: segs,
            original_dimensions,
        } => {
            let bbox = math::compute_bounding_box_segments(&segs);
            let ast = match mode.as_str() {
                "spline" | "chaikin" => {
                    let all_equations: Vec<_> = segs
                        .into_iter()
                        .map(|seg| {
                            let equations = math::spline::build_splines(
                                &seg.data,
                                opts.simplify_math.unwrap_or(true),
                            );
                            models::ColoredPath {
                                color_style: seg.color_style.clone(),
                                data: equations,
                            }
                        })
                        .collect();
                    MathExpressionAST::Spline {
                        equations: all_equations,
                        bounding_box: bbox,
                    }
                }
                "fourier" => {
                    let mut valid_paths = Vec::new();
                    let mut valid_colors = Vec::new();
                    for seg in segs {
                        let pts = math::spline::sample_segments(&seg.data, 100);
                        let ordered_points = math::solve_tsp_nearest_neighbor(pts);
                        valid_paths.push(ordered_points);
                        valid_colors.push(seg.color_style.clone());
                    }

                    let path_refs: Vec<&[models::Point2D]> =
                        valid_paths.iter().map(|p| p.as_slice()).collect();
                    let fourier_adaptive = opts.fourier_adaptive.unwrap_or(true);
                    let fourier_energy = opts.fourier_energy_threshold.unwrap_or(0.995);
                    let batch_results = math::perform_fft_batch(
                        &path_refs,
                        opts.terms,
                        false,
                        fourier_adaptive,
                        fourier_energy,
                    )
                    .map_err(|e| JsValue::from_str(&format!("FFT error: {}", e)))?;

                    let mut strokes = Vec::new();
                    for (terms, color) in batch_results.into_iter().zip(valid_colors) {
                        strokes.push(models::ColoredPath {
                            color_style: color,
                            data: terms,
                        });
                    }
                    MathExpressionAST::Fourier {
                        strokes,
                        bounding_box: bbox,
                    }
                }
                _ => return Err(JsValue::from_str("Unsupported mode for SVG")),
            };
            (ast, original_dimensions)
        }
    };

    Ok(WasmOutput {
        ast,
        width: original_dimensions.0,
        height: original_dimensions.1,
    })
}

#[wasm_bindgen]
pub fn process_image(image_data: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let opts: ProcessOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("Invalid options: {}", e)))?;

    let output = parse_memory(image_data, &opts.format, opts.color)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse image: {}", e)))?;

    let result = build_ast(output, &opts)?;

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)))
}

#[wasm_bindgen]
pub fn process_text(font_bytes: &[u8], text: &str, options: JsValue) -> Result<JsValue, JsValue> {
    if font_bytes.len() > 10 * 1024 * 1024 {
        return Err(JsValue::from_str("Font file too large (max 10MB)"));
    }

    let opts: ProcessOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("Invalid options: {}", e)))?;

    if text.is_empty() {
        // Return an empty transparent layer without throwing a VectomancyError
        let result = WasmOutput {
            ast: MathExpressionAST::Spline {
                equations: vec![],
                bounding_box: [0.0, 0.0, 0.0, 0.0],
            },
            width: 100,
            height: 100,
        };

        return serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)));
    }

    let letter_spacing = opts.letter_spacing.unwrap_or(0.0);
    let (segs, original_dimensions) =
        vectomancy_text::parser::extract_text_outlines(text, font_bytes, 64.0, letter_spacing)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse text: {:?}", e)))?;

    let bbox = math::compute_bounding_box_segments(&segs);
    let all_equations: Vec<_> = segs
        .into_iter()
        .map(|seg| {
            let equations =
                math::spline::build_splines(&seg.data, opts.simplify_math.unwrap_or(true));
            models::ColoredPath {
                color_style: opts.color_style.clone().or_else(|| seg.color_style.clone()),
                data: equations,
            }
        })
        .collect();

    let ast = MathExpressionAST::Spline {
        equations: all_equations,
        bounding_box: bbox,
    };

    let result = WasmOutput {
        ast,
        width: original_dimensions.0,
        height: original_dimensions.1,
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)))
}
