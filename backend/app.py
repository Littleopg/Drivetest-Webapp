import pandas as pd
import geopandas as gpd
import numpy as np
import io
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import traceback
import math
import os

# --- Helper Functions ---

def get_lat_lng_from_location_ref(value: str) -> list[str]:
    """Extract latitude and longitude from string"""
    try:
        location = value.strip('[]')
        lat_lng = location.strip('lat').split('lng')
        return lat_lng
    except Exception:
        return [0, 0]

def clean_for_json(obj):
    """
    Recursively replace NaN and Infinity with None (which maps to JSON null).
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(i) for i in obj]
    elif isinstance(obj, (np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.float64, np.float32)):
        val = float(obj)
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    return obj

def read_msi_data(file_path):
    """Read antenna pattern data from MSI file"""
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        data = f.readlines()
    max_gain = 0.0
    unit = None
    for line in data:
        if line.startswith("GAIN"):
            parts = line.split()
            if len(parts) > 1:
                max_gain = float(parts[1])
                if len(parts) > 2:
                    unit = str(parts[2])
                else:
                    unit = None
                if unit != "dBi":
                    max_gain += 2.15
                    unit = "dBi"
                break
    h_position = next((i for i, line in enumerate(data) if line.startswith('HORIZONTAL')), 0)
    v_position = next((i for i, line in enumerate(data) if line.startswith('VERTICAL')), 0)
    h_gains = []
    v_gains = []
    
    # Safety check for file parsing
    if h_position == 0 or v_position == 0:
        return np.array([0.0]*360), np.array([0.0]*360), max_gain

    for line in data[h_position + 1:v_position]:
        parts = line.split()
        if len(parts) == 2:
            try:
                _, gain = map(float, parts)
                h_gains.append(gain)
            except ValueError:
                continue
    for line in data[v_position + 1:]:
        parts = line.split()
        if len(parts) == 2:
            try:
                _, gain = map(float, parts)
                v_gains.append(gain)
            except ValueError:
                continue
    
    if not h_gains: h_gains = [0.0] * 360
    if not v_gains: v_gains = [0.0] * 360

    return np.array(h_gains), np.array(v_gains), max_gain

def center_maximum(h_gains, v_gains):
    if len(h_gains) == 0: h_gains = np.array([0.0])
    if len(v_gains) == 0: v_gains = np.array([0.0])
    max_index_h = np.argmin(h_gains)
    max_index_v = np.argmin(v_gains)
    h_gains_centered = np.roll(h_gains, -max_index_h)
    v_gains_centered = np.roll(v_gains, -max_index_v)
    return h_gains_centered, v_gains_centered, max_index_h, max_index_v

def indices(h_gains, v_gains):
    if len(h_gains) < 360:
        h_gains = np.pad(h_gains, (0, 360 - len(h_gains)), 'edge')
    if len(v_gains) < 360:
        v_gains = np.pad(v_gains, (0, 360 - len(v_gains)), 'edge')

    temp1h = h_gains[0:181][::-1]
    temp2h = h_gains[181:360][::-1]
    horizontal = np.concatenate((temp1h, temp2h))
    temp1v = v_gains[0:91][::-1]
    temp2v = v_gains[270:360][::-1]
    temp3v = v_gains[91:270][::-1]
    vertical = np.concatenate((temp1v, temp2v, temp3v))
    return horizontal, vertical

def gain_crossweighted(h_gains_centered, v_gains_centered, theta, phi):
    theta = np.array(theta).astype(int)
    phi = np.array(phi).astype(int)
    max_theta_index = len(v_gains_centered) - 1
    max_phi_index = len(h_gains_centered) - 1
    theta = np.clip(theta, -max_theta_index, max_theta_index)
    phi = np.clip(phi, -max_phi_index, max_phi_index)

    k = 2
    pos1 = np.logical_and(phi >= -90, phi <= 90 )
    pos2 = np.logical_or(phi < -90, phi > 90 )
    vert = np.zeros(theta.shape)
    hor = np.zeros(theta.shape)
    
    vert[pos1] = np.power(10,-v_gains_centered[np.clip(theta[pos1] + 90, 0, max_theta_index)]/10)
    vert[pos2] = np.power(10,-v_gains_centered[np.clip(theta[pos2] + 90, 0, max_theta_index)]/10)
    hor[pos1] = np.power(10,-h_gains_centered[np.clip(phi[pos1] + 180, 0, max_phi_index)]/10)
    hor[pos2] = np.power(10,-h_gains_centered[np.clip(phi[pos2] + 180, 0, max_phi_index)]/10)

    w1 = vert*(1-hor)
    w2 = hor*(1-vert)
    
    # Avoid division by zero
    sum_w = np.power(w1, k) + np.power(w2, k)
    denominator = np.power(sum_w, 1/k)
    denominator = np.where(denominator == 0, 1e-9, denominator)
    
    v_gain_vals = v_gains_centered[np.clip(theta + 90, 0, max_theta_index)]
    h_gain_vals = h_gains_centered[np.clip(phi + 180, 0, max_phi_index)]

    Gain = (-h_gain_vals * w1 - v_gain_vals * w2) / denominator
    Gain = np.nan_to_num(Gain, nan=0.0)
    return Gain

class Msi_Antenna_Catalog:
    def __init__(self, msi_file_paths: list[str]):
        self._catalog = dict()
        for msi_file_path in msi_file_paths:
            try:
                h_gains, v_gains, max_gain = read_msi_data(msi_file_path)
                h_gains_centered, v_gains_centered, max_index_h, max_index_v = center_maximum(h_gains, v_gains)
                h_gains_shifted, v_gains_shifted = indices(h_gains_centered, v_gains_centered)
                self._catalog[msi_file_path] = {
                    'h_gains': h_gains, 'v_gains': v_gains, 'max_gain': max_gain,
                    'h_gains_centered': h_gains_centered, 'v_gains_centered': v_gains_centered,
                    'h_gains_shifted': h_gains_shifted, 'v_gains_shifted': v_gains_shifted,
                    'max_index_h': max_index_h, 'max_index_v': max_index_v,
                    'horizontal_beam_width': self._calculate_horizontal_beam_width(h_gains_shifted),
                    'vertical_beam_width': self._calculate_vertical_beam_width(v_gains_shifted)
                }
            except FileNotFoundError:
                print(f"WARNING: MSI file not found and will be skipped: {msi_file_path}")
            except Exception as e:
                print(f"WARNING: Error processing MSI file {msi_file_path}: {e}")
                print(traceback.format_exc())

    def _calculate_horizontal_beam_width(self, h_gains_shifted):
        if len(h_gains_shifted) < 180: return 0
        left_h = h_gains_shifted[:180][::-1]
        right_h = h_gains_shifted[179:]
        try:
            left_horizontal_beam_width = np.absolute(left_h-(3)).argmin() - 1
            right_horizontal_beam_width = np.absolute(right_h-(3)).argmin() - 1
            return left_horizontal_beam_width + right_horizontal_beam_width
        except:
            return 0

    def _calculate_vertical_beam_width(self, v_gains_shifted):
        if len(v_gains_shifted) < 90: return 0
        up_v = v_gains_shifted[:90][::-1]
        right_v = v_gains_shifted[89:]
        try:
            left_vertical_beam_width = np.absolute(up_v-(3)).argmin() - 1
            right_vertical_beam_width = np.absolute(right_v-(3)).argmin() - 1
            return left_vertical_beam_width + right_vertical_beam_width
        except:
            return 0

    def get_horizontal_beam_width(self, msi_file_path: str):
        if msi_file_path in self._catalog:
            return self._catalog[msi_file_path]['horizontal_beam_width']
        return 0

    def get_vertical_beam_width(self, msi_file_path: str):
        if msi_file_path in self._catalog:
            return self._catalog[msi_file_path]['vertical_beam_width']
        return 0

    def get_diff_azimuth(self, msi_file_path: str):
        if msi_file_path not in self._catalog:
            return 0
        max_index_h = self._catalog[msi_file_path]['max_index_h']
        if max_index_h < 180:
            return max_index_h
        else:
            return (max_index_h - 360)

    def get_gain_3D(self, msi_file_path: str, theta: int, phi: int):
        if msi_file_path not in self._catalog:
            return -99
        catalog_entry = self._catalog[msi_file_path]
        try:
            theta = int(round(theta, 0))
            phi = int(round(phi, 0))
        except ValueError:
            return -99

        if phi == 180: phi = -180
        h_gains_shifted = catalog_entry['h_gains_shifted']
        v_gains_shifted = catalog_entry['v_gains_shifted']
        max_gain = catalog_entry['max_gain']
        if len(h_gains_shifted) == 0 or len(v_gains_shifted) == 0:
            return max_gain
        return gain_crossweighted(h_gains_shifted, v_gains_shifted, theta, phi) + max_gain

FloatArray = np.typing.NDArray[np.float64]

def cal_bearing(lat_A: FloatArray, long_A: FloatArray, lat_B: FloatArray, long_B: FloatArray) -> FloatArray:
    lat_rad_A = lat_A * np.pi / 180
    long_rad_A = long_A * np.pi / 180
    lat_rad_B = lat_B * np.pi / 180
    long_rad_B = long_B * np.pi / 180
    y = np.sin(long_rad_B - long_rad_A) * np.cos(lat_rad_B)
    x = np.cos(lat_rad_A) * np.sin(lat_rad_B) - np.sin(lat_rad_A) * np.cos(lat_rad_B) * np.cos(long_rad_B - long_rad_A)
    bearing = np.arctan2(y, x)
    bearing = bearing * 180 / np.pi
    bearing = bearing % 360
    return bearing

def cal_distance(lat_A: FloatArray, long_A: FloatArray, lat_B: FloatArray, long_B: FloatArray) -> FloatArray:
    lat_rad_A = lat_A * np.pi / 180
    long_rad_A = long_A * np.pi / 180
    lat_rad_B = lat_B * np.pi / 180
    long_rad_B = long_B * np.pi / 180
    a = ((np.sin((lat_rad_A - lat_rad_B) / 2)) ** 2) + np.cos(lat_rad_A) * np.cos(lat_rad_B) * ((np.sin((long_rad_A - long_rad_B) / 2)) ** 2)
    r = 6_371_000
    distance = 2 * r * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    return distance

def path_loss_spm(parameters, k1, k2, k3, k4, k5, k6):
    d_2D, h_tx, h_rx = parameters
    d_2D = np.maximum(d_2D, 1e-9)
    h_tx = np.maximum(h_tx, 1e-9)
    h_rx = np.maximum(h_rx, 1e-9)
    PL = k1 + k2*np.log10(d_2D) + k3*np.log10(h_tx) + k4*np.log10(d_2D)*np.log10(h_tx) + k5*h_rx + k6*np.log10(h_rx)
    return PL

def mean_absolute_error(y_true, y_pred):
    return np.mean(np.abs(y_true - y_pred))

def root_mean_squared_error(y_true, y_pred):
    return np.sqrt(np.mean((y_true - y_pred)**2))

def spm_assess_and_visualize(y_true, y_pred, distance, tx_height, rx_height, K, title):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = root_mean_squared_error(y_true, y_pred)
    print(f"Title: {title} - MAE: {mae:.3f}, RMSE: {rmse:.3f}")
    return {'mae': mae, 'rmse': rmse}

def haversine(lat1, lon1, lat2, lon2):
    if np.any(np.isnan([lat1, lon1, lat2, lon2])): return 0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    r = 6371
    return r * c

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Define UPLOAD_FOLDER globally
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'static', 'models')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
CONFIG_FILE = os.path.join(os.getcwd(), 'model_configs.json')

# --- MSI Data Loading ---
MB4B_msi_files = [{'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_780.msi', 'frequency': 700, 'ant_model': 'MB4B/MF/MF-65-15/18/18DE-IN-43-TH', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_940.msi', 'frequency': 900, 'ant_model': 'MB4B/MF/MF-65-15/18/18DE-IN-43-TH', 'e_tilt': 2.0, 'ant_logical_beam': 1}]
TS_msi_files = [{'msi_file_path': './MB3F-65-21DE10-TH/MSI/B1/MB3F-65-21DE10-TH_B1+45_T2_1830.msi', 'frequency': 700, 'ant_model': 'TS-698/2700-10/14-4(43)', 'e_tilt': 0.0, 'ant_logical_beam': 1}, {'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_940(1).msi', 'frequency': 900, 'ant_model': 'MB4B/MF/MF-65-15/18/18DE-IN-43-TH', 'e_tilt': 0.0, 'ant_logical_beam': 1}]
MBMF_msi_files = [{'msi_file_path': './MBMF-65-21DDE-IN-43(R)-TH/MSI/Y1/MBMF-65-21DDE-IN-43(R)-TH_Y1+45_T2_1830.msi', 'frequency': 1800, 'ant_model': 'MBMF-65-21DDE-IN-43(R)-TH', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './MBMF-65-21DDE-IN-43(R)-TH/MSI/Y1/MBMF-65-21DDE-IN-43(R)-TH_Y1+45_T2_2150.msi', 'frequency': 2100, 'ant_model': 'MBMF-65-21DDE-IN-43(R)-TH', 'e_tilt': 2.0, 'ant_logical_beam': 1}]
LL2_msi_files = [
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/2C/J1-2LLPX0408P-E2-C-B_02DT_1830.msi', 'frequency': 1800, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 2.0, 'ant_logical_beam': 1}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/2C/J1-2LLPX0408P-E2-C-B_02DT_2150.msi', 'frequency': 2100, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 2.0, 'ant_logical_beam': 1}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/4C/J1-2LLPX0408P-E2-C-B_04DT_1830.msi', 'frequency': 1800, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 3.0, 'ant_logical_beam': 1}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/4C/J1-2LLPX0408P-E2-C-B_04DT_2150.msi', 'frequency': 2100, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 3.0, 'ant_logical_beam': 1},
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/2C/J1-2LLPX0408P-E2-C-B_02DT_1830.msi', 'frequency': 1800, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 2.0, 'ant_logical_beam': 2}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/2C/J1-2LLPX0408P-E2-C-B_02DT_2150.msi', 'frequency': 2100, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 2.0, 'ant_logical_beam': 2}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/4C/J1-2LLPX0408P-E2-C-B_04DT_1830.msi', 'frequency': 1800, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 3.0, 'ant_logical_beam': 2}, 
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/4C/J1-2LLPX0408P-E2-C-B_04DT_2150.msi', 'frequency': 2100, 'ant_model': '2LLPX0408P-E2-C', 'e_tilt': 3.0, 'ant_logical_beam': 2}
]
MB3F_msi_files = [{'msi_file_path': './MB3F-65-21DE10-TH/MSI/B1/MB3F-65-21DE10-TH_B1+45_T6_1830.msi', 'frequency': 1800, 'ant_model': 'MB3F-30-21DE10-TH', 'e_tilt': 6.0, 'ant_logical_beam': 1}, {'msi_file_path': './MB3F-65-21DE10-TH/MSI/B1/MB3F-65-21DE10-TH_B1+45_T6_2150.msi', 'frequency': 2100, 'ant_model': 'MB3F-30-21DE10-TH', 'e_tilt': 6.0, 'ant_logical_beam': 1}]
AAU_msi_files = [
    {'msi_file_path': './2LLPX0408P-E2-C/MSI_2LLPX0408P-E2-C/2LLPX0408P-E2-C_msi/12/2C/J1-2LLPX0408P-E2-C-B_02DT_2150.msi', 'frequency': 2600, 'ant_model': 'MB3F-30-21DE10-TH', 'e_tilt': 0.0, 'ant_logical_beam': 1}
]
A19_msi_files = [{'msi_file_path': './MB4BMFMF-65-151818DE-IN-43-TH/MSI/Y1/MB4BMFMF-65-151818DE-IN-43-TH_Y1+45_T2_2150.msi', 'frequency': 1800, 'ant_model': 'A19451811', 'e_tilt': 2.5, 'ant_logical_beam': 1}, {'msi_file_path': './MB4BMFMF-65-151818DE-IN-43-TH/MSI/Y1/MB4BMFMF-65-151818DE-IN-43-TH_Y1+45_T2_2150.msi', 'frequency': 2100, 'ant_model': 'A19451811', 'e_tilt': 2.5, 'ant_logical_beam': 1}, {'msi_file_path': './MB4BMFMF-65-151818DE-IN-43-TH/MSI/Y1/MB4BMFMF-65-151818DE-IN-43-TH_Y1+45_T2_2150.msi', 'frequency': 1800, 'ant_model': 'A19451811', 'e_tilt': 9.0, 'ant_logical_beam': 1}, {'msi_file_path': './MB4BMFMF-65-151818DE-IN-43-TH/MSI/Y1/MB4BMFMF-65-151818DE-IN-43-TH_Y1+45_T2_2150.msi', 'frequency': 2100, 'ant_model': 'A19451811', 'e_tilt': 9.0, 'ant_logical_beam': 1}, {'msi_file_path': './ADU4518R6v06_Multi-band_High band_4 Ports/ADU4518R6v06_1710_X_CO_M45_02T_yL.msi', 'frequency': 1800, 'ant_model': 'A19451811', 'e_tilt': 8.0, 'ant_logical_beam': 1}, {'msi_file_path': './ADU4518R6v06_Multi-band_High band_4 Ports/ADU4518R6v06_1710_X_CO_M45_02T_yL.msi', 'frequency': 2100, 'ant_model': 'A19451811', 'e_tilt': 8.0, 'ant_logical_beam': 1}]
AMB_msi_files = [{'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_07T_RB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 9.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_07T_RB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 9.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_07T_LB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 9.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_07T_LB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 9.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_12T_RB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 10.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_12T_RB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 10.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_12T_LB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 10.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_12T_LB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 10.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_02T_RB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 6.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_02T_RB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 6.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_1750_X_CO_M45_02T_LB.msi', 'frequency': 1800, 'ant_model': 'AMB4520R0', 'e_tilt': 6.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4520R0_Dual_beam Antenna/AMB4520R0_2140_X_CO_M45_02T_LB.msi', 'frequency': 2100, 'ant_model': 'AMB4520R0', 'e_tilt': 6.0, 'ant_logical_beam': 2}]
K80_msi_files = [{'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_940(1).msi', 'frequency': 900, 'ant_model': 'K80010305', 'e_tilt': 0.0, 'ant_logical_beam': 1}]
DDE18_msi_files = [{'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_780.msi', 'frequency': 700, 'ant_model': 'MB4B-65-18DDE-IN-43(R)-TH ', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './MB4B-65-18DDE-IN-43(R)-TH/MSI/R1/MB4B-65-18DDE-IN-43(R)-TH_R1+45_T2_940(1).msi', 'frequency': 900, 'ant_model': 'MB4B-65-18DDE-IN-43(R)-TH ', 'e_tilt': 2.0, 'ant_logical_beam': 1}]
A4519_msi_files = [{'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_1805_X_CO_M45_02T_RTy4.msi', 'frequency': 1800, 'ant_model': 'AMB4519R6v06', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_2140_X_CO_M45_02T_RTy4.msi', 'frequency': 2100, 'ant_model': 'AMB4519R6v06 ', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_1805_X_CO_M45_02T_LBy1.msi', 'frequency': 1800, 'ant_model': 'AMB4519R6v06', 'e_tilt': 2.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_2140_X_CO_M45_02T_LBy1.msi', 'frequency': 2100, 'ant_model': 'AMB4519R6v06 ', 'e_tilt': 2.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_1805_X_CO_P45_07T_RTy4.msi', 'frequency': 1800, 'ant_model': 'AMB4519R6v06', 'e_tilt': 5.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_2140_X_CO_P45_07T_RTy4.msi', 'frequency': 2100, 'ant_model': 'AMB4519R6v06 ', 'e_tilt': 5.0, 'ant_logical_beam': 1}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_1805_X_CO_P45_07T_LTy2.msi', 'frequency': 1800, 'ant_model': 'AMB4519R6v06', 'e_tilt': 5.0, 'ant_logical_beam': 2}, {'msi_file_path': './AMB4519R6v06_Multi_beam_4T4R Dual-beam Antenna/AMB4519R6v06_2140_X_CO_P45_07T_LTy2.msi', 'frequency': 2100, 'ant_model': 'AMB4519R6v06 ', 'e_tilt': 5.0, 'ant_logical_beam': 2}]
A4518_msi_files = [{'msi_file_path': './ADU4518R6v06_Multi-band_High band_4 Ports/ADU4518R6v06_1843_X_CO_M45_02T_yL.msi', 'frequency': 1800, 'ant_model': 'ADU4518R6v06', 'e_tilt': 2.0, 'ant_logical_beam': 1}, {'msi_file_path': './ADU4518R6v06_Multi-band_High band_4 Ports/ADU4518R6v06_2140_X_CO_M45_02T_yL.msi', 'frequency': 2100, 'ant_model': 'ADU4518R6v06', 'e_tilt': 2.0, 'ant_logical_beam': 1}]

all_msi_file_list = [*MB4B_msi_files, *TS_msi_files, *MBMF_msi_files,*LL2_msi_files, *MB3F_msi_files, *AAU_msi_files,*A19_msi_files, *AMB_msi_files, *K80_msi_files,*DDE18_msi_files, *A4519_msi_files, *A4518_msi_files]
msi_file_df = pd.DataFrame(all_msi_file_list)  
unique_msi_files = msi_file_df['msi_file_path'].unique()

print(f"Loading {len(unique_msi_files)} unique MSI antenna patterns at startup...")
msi_antenna_catalog = Msi_Antenna_Catalog(unique_msi_files)
msi_file_df['diff_azimuth'] = msi_file_df['msi_file_path'].apply(msi_antenna_catalog.get_diff_azimuth)
msi_file_df['horizontal_beam_width'] = msi_file_df['msi_file_path'].apply(msi_antenna_catalog.get_horizontal_beam_width)
msi_file_df['vertical_beam_width'] = msi_file_df['msi_file_path'].apply(msi_antenna_catalog.get_vertical_beam_width)
msi_file_df_sorted = msi_file_df.sort_values('e_tilt')

print("MSI Catalog loaded.")

# --- Global Config State ---
cell_config_with_msi = pd.DataFrame()

# --- Load Configuration Files ---
try:
    print("Loading KMITL configuration files at startup...")
    # NOTE: Ensure these CSV files exist in the root directory
    site_df = pd.read_csv('./KMITL_site.csv')
    cell_4g_df = pd.read_csv('./KMITL_cell_4g.csv')
    ref_ant_df = pd.read_csv('./KMITL_ref_ant.csv')
    cell_4g_ant_df = pd.read_csv('./KMITL_cell_4g_ant.csv')
    ant_df = pd.read_csv('./KMITL_ant.csv')

    lat_lng = site_df['location_ref'].apply(get_lat_lng_from_location_ref)
    site_df['site_latitude'] = [item[0] for item in lat_lng]
    site_df['site_longitude'] = [item[1] for item in lat_lng]
    site_df = site_df.drop(columns=['location_ref'])

    cell_4g_df['frequency'] = cell_4g_df['cell_name'].str[6:8].astype(int) * 100
    cell_4g_df['rspwr'] = cell_4g_df['rspwr'] / 10

    ant_df['e_tilt'] = ant_df['e_tilt'] / 10

    first_merge_df = site_df.merge(cell_4g_df, on='site_code', how='inner')
    first_merge_df = first_merge_df.drop(columns=['site_name_en', 'site_name_th'])
    second_merge_df = first_merge_df.merge(cell_4g_ant_df, on='cell_name', how='inner')
    third_merge_df = second_merge_df.merge(ant_df, on=['ant_id', 'ant_logical_beam'], how='inner')
    
    band_mapping = {
        700: 'Low Band', 900: 'Low Band', 1800: 'Mid Band',
        2100: 'Mid Band', 2300: 'Mid Band', 2600: 'High Band',
    }
    third_merge_df['band'] = third_merge_df['frequency'].map(band_mapping)
    cell_configuration_df = third_merge_df.merge(ref_ant_df, on=['ant_model', 'ant_logical_beam', 'band'], how='inner')
    
    if 'diff_azimuth' in cell_configuration_df.columns:
        cell_configuration_df = cell_configuration_df.drop(columns=['diff_azimuth', 'horizontal_beam_width', 'vertical_beam_width'])
    
    cell_configuration_df_sorted = cell_configuration_df.sort_values('e_tilt')
    
    cell_config_with_msi = pd.merge_asof(
        cell_configuration_df_sorted, 
        msi_file_df_sorted, 
        on='e_tilt', 
        by=['frequency', 'ant_model', 'ant_logical_beam'], 
        direction='nearest'
    )
    print("Configuration files processed and merged with MSI catalog.")

except FileNotFoundError as e:
    print(f"FATAL ERROR: Missing configuration file at startup: {e.filename}")
    print("The server will run, but /upload will fail.")
except Exception as e:
    print(f"FATAL ERROR: Failed to load or process config files at startup: {e}")
    print(traceback.format_exc())


# --- Routes (Defined globally, NOT inside try/except) ---

@app.route('/upload-model', methods=['POST'])
def upload_model():
    if 'modelFile' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['modelFile']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        try:
            # Save the file to the static/models folder
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
            file.save(file_path)
            
            # Generate the URL that React will use to load the model
            file_url = f"{request.host_url}static/models/{file.filename}"
            
            return jsonify({
                'message': 'File uploaded successfully',
                'url': file_url
            })
        except Exception as e:
            return jsonify({'error': f"Failed to save file: {str(e)}"}), 500

@app.route('/static/models/<path:filename>')
def serve_model(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Helper to load existing configs
def load_configs():
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, 'r') as f:
        try:
            return json.load(f)
        except:
            return {}

# Helper to save configs
def save_configs(configs):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(configs, f, indent=4)

# --- NEW ROUTE: Save Configuration ---
# --- NEW ROUTE: Save Configuration ---
@app.route('/save-config', methods=['POST'])
def save_model_config():
    data = request.json
    filename = data.get('filename')
    config = data.get('config')
    
    if not filename or not config:
        return jsonify({'error': 'Missing filename or config'}), 400

    # Load, Update, Save
    current_configs = load_configs()
    
    # FIX: Merge the dictionaries so we don't overwrite model metadata (like rotateX, scale, label)
    if filename in current_configs:
        current_configs[filename].update(config)
    else:
        current_configs[filename] = config
        
    save_configs(current_configs)
    
    return jsonify({'message': 'Configuration saved successfully'})

# --- NEW ROUTE: Get Configuration ---
@app.route('/get-config/<path:filename>', methods=['GET'])
def get_model_config(filename):
    current_configs = load_configs()
    if filename in current_configs:
        return jsonify(current_configs[filename])
    else:
        return jsonify({}) # Return empty if no config exists

@app.route('/get-all-configs', methods=['GET'])
def get_all_configs():
    # Returns the entire dictionary of saved models
    return jsonify(load_configs())

@app.route('/delete-config/<filename>', methods=['DELETE'])
def delete_config(filename):
    try:
        # Load config
        configs = {}
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                try:
                    configs = json.load(f)
                except json.JSONDecodeError:
                    configs = {}

        # Remove from JSON
        if filename in configs:
            del configs[filename]
            with open(CONFIG_FILE, 'w') as f:
                json.dump(configs, f, indent=4)

        # Remove actual file
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        return jsonify({"message": f"Successfully deleted {filename}"}), 200

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/models', methods=['GET'])
def get_models():
    # This function reads your config.json and sends it to React
    data = load_configs() 
    return jsonify(data)

@app.route('/upload-indoor', methods=['POST'])
def upload_indoor_csv():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    # Floor Height: Distance between floors in meters (mapped to the Y-axis)
    try:
        floor_height = float(request.form.get('floor_height', 4.0))
    except ValueError:
        floor_height = 4.0
    
    try:
        df = pd.read_csv(file, delimiter=';', na_values='—', encoding='utf-8')
        df.columns = df.columns.str.strip()
        df = df.ffill()
        
        lat_col = 'lat'
        lon_col = 'long'
        rssi_col = 'rssi_strongest' if 'rssi_strongest' in df.columns else 'rssi'
        
        if not {lat_col, lon_col, rssi_col}.issubset(df.columns):
            return jsonify({"error": f"Missing required columns ({lat_col}, {lon_col}, {rssi_col})"}), 400
        
        df = df.dropna(subset=[lat_col, lon_col, rssi_col]).reset_index(drop=True)
        if df.empty:
            return jsonify({"error": "No valid data rows"}), 400
            
        ts_col = next((c for c in df.columns if c.lower() in ['sys_time', 'timestamp', 'time']), None)
        if ts_col:
            try:
                df['parsed_time'] = pd.to_datetime(df[ts_col].astype(str), format='%Y%m%d%H%M%S', errors='coerce')
                if df['parsed_time'].isna().all():
                    df['parsed_time'] = pd.to_datetime(df[ts_col], errors='coerce')
            except:
                df['parsed_time'] = pd.to_datetime(df[ts_col], errors='coerce')
        else:
            df['parsed_time'] = pd.NaT

        df['prev_y'] = df[lat_col].shift(1)
        df['prev_x'] = df[lon_col].shift(1)
        df['prev_timestamp'] = df['parsed_time'].shift(1)

        # 1. ESTABLISH LOCAL ORIGIN (in meters)
        origin_y = df.iloc[0][lat_col]
        origin_x = df.iloc[0][lon_col]
        
        # Determine Floor origin
        floor_col = next((c for c in df.columns if c.lower() in ['baro_floor', 'gps_floor', 'floor']), None)
        if floor_col:
            df['parsed_floor'] = pd.to_numeric(df[floor_col], errors='coerce').fillna(0)
        else:
            df['parsed_floor'] = 0.0
        origin_floor = df.iloc[0]['parsed_floor']

        # 2. PURE CARTESIAN DISTANCE (Euclidean meters)
        # Since lat/long are already local Cartesian coordinates in meters,
        # calculate Euclidean distance directly without any scaling.
        df['distance_m'] = np.sqrt(
            (df[lon_col] - df['prev_x'])**2 + 
            (df[lat_col] - df['prev_y'])**2
        )

        df['distance_km'] = df['distance_m'] / 1000.0
        df['time_diff_seconds'] = (df['parsed_time'] - df['prev_timestamp']).dt.total_seconds().fillna(0)
        
        # Speed is calculated off Cartesian distance
        df['calculated_speed'] = np.where(
            df['time_diff_seconds'] > 0, 
            (df['distance_km'] / (df['time_diff_seconds'] / 3600.0)), 
            0
        )
        df['calculated_speed'] = df['calculated_speed'].replace([np.inf, -np.inf], 0).fillna(0)
        
        def safe_val(val, default='—'):
            if pd.isna(val) or str(val).strip() == '': 
                return default
            return val
            
        def get_any_col(row, possible_names):
            for col in possible_names:
                for df_col in df.columns:
                    if df_col.lower() == col.lower() and pd.notna(row[df_col]) and str(row[df_col]).strip() != '':
                        return row[df_col]
            return '—'
            
        points = []
        for idx, row in df.iterrows():
            # 3. DIRECT METER OFFSETS (No arbitrary scaling factor)
            # This zeroes out the starting position so the 3D visualizer 
            # can plot the path relative to the draggable CSV Origin marker.
            delta_x = row[lon_col] - origin_x
            delta_z = -(row[lat_col] - origin_y) 
            
            # Explicit Y-Axis Mapping for Floor Changes
            delta_y = (row['parsed_floor'] - origin_floor) * floor_height
            
            raw_report = get_any_col(row, ['report', 'Report Number', 'Report No'])
            try:
                report_num = int(float(raw_report))
            except:
                report_num = int(idx + 1)
            
            points.append({
                "index": report_num,
                "deltaX": round(delta_x, 3),
                "deltaY": round(delta_y, 3), 
                "deltaZ": round(delta_z, 3),
                "rssi": float(row[rssi_col]), 
                "timestamp": str(get_any_col(row, ['sys_time', 'timestamp', 'Time'])),
                "net_op_name": str(get_any_col(row, ['net_op_name', 'SSIDNAME', 'ssid', 'SSID', 'Network'])),
                "band": str(get_any_col(row, ['band', 'Band'])),
                "rsrp": str(get_any_col(row, ['rssi_strongest', 'rsrp', 'RSRP', 'rssi'])),
                "rsrq": str(get_any_col(row, ['rsrq', 'RSRQ'])),
                "lat": float(row[lat_col]),
                "long": float(row[lon_col]),
                "speed": str(round(row['calculated_speed'], 2)),
                "baro_pressure": str(get_any_col(row, ['baro_pressure'])),
                "baro_rel_alt": str(get_any_col(row, ['baro_rel_alt'])),
                "baro_floor": str(get_any_col(row, ['baro_floor'])),
                "altitude": str(get_any_col(row, ['altitude', 'gps_abs_alt'])),
                "gps_rel_alt": str(get_any_col(row, ['gps_rel_alt'])),
                "gps_floor": str(get_any_col(row, ['gps_floor'])),
                "bssid": str(get_any_col(row, ['bssid', 'BSSID', 'mac', 'MAC', 'MAC Address'])),
                "snr": str(get_any_col(row, ['snr', 'SNR'])),
                "Frequency": str(get_any_col(row, ['Frequency', 'freq', 'FREQ', 'Frequency(MHz)'])),
                "cell_id": str(get_any_col(row, ['cell_id', 'cid_bid', 'Cell ID'])),
                "ARFCN": str(get_any_col(row, ['ARFCN', 'arfcn', 'Channel'])),
                "floor": float(row['parsed_floor']),
                "tech": str(get_any_col(row, ['tech', 'Tech', 'serving_tech'])),
            })
            
        return jsonify({"points": points})
        
    except Exception as e:
        import traceback
        print(f"Error processing indoor CSV: {e}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500
    
@app.route('/upload-neighbor', methods=['POST'])
def upload_neighbor_csv():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        # Read the CSV
        df = pd.read_csv(file, delimiter=';', na_values='—', encoding='utf-8')
        
        # Clean up column names (removes hidden spaces)
        df.columns = df.columns.str.strip()
        
        # Forward-fill empty cells just like we did for the indoor points
        df = df.ffill()
        
        # Replace NaN values with '—' so JSON doesn't break
        df = df.fillna('—')
        
        # Convert the dataframe directly to a list of dictionaries
        neighbors = df.to_dict(orient='records')
            
        return jsonify({"neighbors": neighbors})
        
    except Exception as e:
        import traceback
        print(f"Error processing neighbor CSV: {e}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500  
     
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'serving_file' not in request.files:
        return jsonify({"error": "No serving file part"}), 400
    
    serving_file = request.files['serving_file']
    neighbor_file = request.files.get('neighbor_file') 
    mapping_str = request.form.get('mapping')
    network_type = request.form.get('network_type', 'cellular') 

    if cell_config_with_msi.empty and network_type == 'cellular':
         return jsonify({"error": "Server failed to load configuration files (KMITL csv files). check server logs."}), 500

    try:
        column_mapping = {}
        if mapping_str:
            try:
                mapping_json = json.loads(mapping_str)
                rename_dict = {v: k for k, v in mapping_json.items() if v}
            except json.JSONDecodeError:
                print("Invalid mapping JSON")
                rename_dict = {}
        else:
             rename_dict = {}

        file_buffer = io.BytesIO(serving_file.read())
        serving_file.close() 
        file_buffer.seek(0)
        
        # Read the CSV
        df = pd.read_csv(file_buffer, sep=None, engine='python', na_values='—', encoding='utf-8')
    
        # Apply the mapping
        if rename_dict:
             df.rename(columns=rename_dict, inplace=True)

        if network_type == 'cellular':
            required_cols_map = {
                'report': 'report', 
                'sys_time': 'timestamp', 
                'lat': 'latitude', 
                'long': 'longitude',
                'rssi': 'rsrp', 
                'rsrq': 'rsrq', 
                'band': 'band',
                'net_op_name': 'net_op_name', 
                'node_id_nid': 'enodeb_id', 
                'cid_bid': 'cell_id',
            }
        else:
            required_cols_map = {
                'report': 'report', 
                'sys_time': 'timestamp', 
                'lat': 'latitude', 
                'long': 'longitude',
                'rssi': 'rsrp',      
                'band': 'band',
                'cid_bid': 'cell_id' 
            }
        
        optional_cols_map = {
            'baro_pressure': 'baro_pressure',
            'baro_rel_alt': 'baro_rel_alt',
            'baro_floor': 'baro_floor',
            'gps_rel_alt': 'gps_rel_alt',
            'gps_floor' : 'gps_floor',
            'altitude': 'altitude',
            'net_op_name': 'net_op_name',   
            'tech': 'tech',
            'serving_tech': 'serving_tech',
        }

        if not set(required_cols_map.keys()).issubset(df.columns):
            missing_cols = set(required_cols_map.keys()) - set(df.columns)
            return jsonify({"error": f"Missing required columns (check mapping): {', '.join(missing_cols)}"}), 400
        
        cols_to_keep = list(required_cols_map.keys())
        for col in optional_cols_map.keys():
            if col in df.columns:
                cols_to_keep.append(col)
        
        cols_to_keep = list(dict.fromkeys(cols_to_keep))
        
        df = df[cols_to_keep] 
        df = df.rename(columns=required_cols_map) 
        df = df.loc[:, ~df.columns.duplicated()].copy()
        
        fallback_cols = {'rsrq': np.nan, 'net_op_name': 'N/A', 'enodeb_id': np.nan, 'cell_id': 'N/A'}
        for missing_col, default_val in fallback_cols.items():
            if missing_col not in df.columns:
                df[missing_col] = default_val

        for key, target_name in optional_cols_map.items():
            if target_name not in df.columns:
                 df[target_name] = np.nan

        df['timestamp'] = pd.to_datetime(df['timestamp'], format='%Y%m%d%H%M%S')
        df = df.sort_values(by='timestamp').reset_index(drop=True)
        
        numeric_cols = ['latitude', 'longitude', 'rsrp', 'rsrq', 'altitude', 'baro_pressure', 'baro_rel_alt', 'baro_floor', 'gps_rel_alt']
        for col in numeric_cols:
             if col in df.columns:
                 df[col] = pd.to_numeric(df[col], errors='coerce')

        if network_type == 'cellular':
            for col in ['enodeb_id', 'cell_id']:
                df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
        else:
            df['cell_id'] = df['cell_id'].astype(str).replace('nan', 'N/A')
        
        df['band'] = df['band'].astype(str).fillna('N/A')
        df['net_op_name'] = df['net_op_name'].astype(str).fillna('N/A')

        if network_type == 'cellular':
            df.dropna(subset=['timestamp', 'latitude', 'longitude', 'enodeb_id', 'cell_id'], inplace=True)
        else:
            df.dropna(subset=['timestamp', 'latitude', 'longitude'], inplace=True)

        df['prev_latitude'] = df['latitude'].shift(1)
        df['prev_longitude'] = df['longitude'].shift(1)
        df['prev_timestamp'] = df['timestamp'].shift(1)

        df['distance_km'] = df.apply(
            lambda row: haversine(
                row['prev_latitude'], row['prev_longitude'],
                row['latitude'], row['longitude']
            ),
            axis=1
        ).fillna(0)

        df['time_diff_seconds'] = (df['timestamp'] - df['prev_timestamp']).dt.total_seconds().fillna(0)
        df['driving_speed_kmh'] = (df['distance_km'] / (df['time_diff_seconds'] / 3600.0))
        df['driving_speed_kmh'] = df['driving_speed_kmh'].replace([np.inf, -np.inf], 0).fillna(0)
        
        df = df.drop(columns=['prev_latitude', 'prev_longitude', 'prev_timestamp', 'distance_km', 'time_diff_seconds'])
        df['sys_time'] = df['timestamp'].dt.strftime('%Y%m%d%H%M%S')
        
        raw_data_df = df.copy()
        raw_data_df = raw_data_df.replace([np.inf, -np.inf], np.nan).where(pd.notna(raw_data_df), None)
        raw_data = raw_data_df.drop(columns=['timestamp']).to_dict(orient='records')

        GRID_SIZE = 0.00015
        df['grid_lat'] = (df['latitude'] / GRID_SIZE).round() * GRID_SIZE
        df['grid_lon'] = (df['longitude'] / GRID_SIZE).round() * GRID_SIZE
        
        grid_agg = df.groupby(['grid_lat', 'grid_lon']).agg(
            sys_time=('sys_time', 'first'),
            rsrp_avg=('rsrp', 'mean'), 
            rsrq_avg=('rsrq', 'mean'), 
            speed_avg=('driving_speed_kmh', 'mean'),
            altitude_avg=('altitude', 'mean'),
            pressure_avg=('baro_pressure', 'mean'),
            baro_rel_alt_avg=('baro_rel_alt', 'mean'),
            floor_avg=('baro_floor', 'mean'),
            gps_rel_alt_avg=('gps_rel_alt', 'mean'),
            point_count=('rsrp', 'size'),
            band=('band', 'first'),
            net_op_name=('net_op_name', 'first'),
            cell_id=('cell_id', 'first'),
            tech=('tech', 'first') if 'tech' in df.columns else ('net_op_name', 'first'), 
            serving_tech=('serving_tech', 'first') if 'serving_tech' in df.columns else ('net_op_name', 'first'),
        ).reset_index()

        grid_agg['rsrp_avg'] = grid_agg['rsrp_avg'].round(1)
        grid_agg['rsrq_avg'] = grid_agg['rsrq_avg'].round(1)
        grid_agg['speed_avg'] = grid_agg['speed_avg'].round(2)
        grid_agg['altitude_avg'] = grid_agg['altitude_avg'].round(2)
        grid_agg['pressure_avg'] = grid_agg['pressure_avg'].round(2)
        grid_agg['baro_rel_alt_avg'] = grid_agg['baro_rel_alt_avg'].round(2)
        grid_agg['floor_avg'] = grid_agg['floor_avg'].round(1)
        grid_agg['gps_rel_alt_avg'] = grid_agg['gps_rel_alt_avg'].round(2)

        grid_agg['grid_size'] = GRID_SIZE
        grid_agg = grid_agg.replace([np.inf, -np.inf], np.nan).where(pd.notna(grid_agg), None)
        grid_data = grid_agg.to_dict(orient='records')

        neighbor_data = []
        if neighbor_file and neighbor_file.filename.endswith('.csv'):
            try:
                neighbor_buffer = io.BytesIO(neighbor_file.read())
                neighbor_file.close()
                df_neighbor = pd.read_csv(neighbor_buffer, delimiter=';', na_values='—', encoding='utf-8')
                cols_lower = {c: c.lower().strip() for c in df_neighbor.columns}
                report_col = next((orig for orig, low in cols_lower.items() if 'report' in low), None)
                if report_col and report_col != 'report':
                    df_neighbor.rename(columns={report_col: 'report'}, inplace=True) 
                
                df_neighbor = df_neighbor.replace([np.inf, -np.inf], np.nan).where(pd.notna(df_neighbor), None)
                neighbor_data = df_neighbor.to_dict(orient='records')
            except Exception as e:
                print(f"Error processing neighbor file: {e}")

        if network_type == 'wifi':
            response_data = {
                "rawData": raw_data,
                "neighborData": neighbor_data,
                "gridData": grid_data,
                "analysisMetrics": [],
                "plotData": {}, 
                "plotData_cell" : {}
            }
            cleaned_data = clean_for_json(response_data)
            return jsonify(cleaned_data)


        # -------------------------------------------------------------
        # CELLULAR PATH LOSS & SPM MATH
        # -------------------------------------------------------------
        analysis_df = df.copy()
        analysis_df = analysis_df.rename(columns={'rsrp': 'mean_rsrp'})
        usecols = ['latitude', 'longitude', 'enodeb_id', 'cell_id', 'mean_rsrp']
        analysis_df = analysis_df[usecols]
        analysis_df = analysis_df.dropna()

        # 1. Left join to keep map points alive even without matches
        grid_with_msi_file = analysis_df.merge(cell_config_with_msi, on=['enodeb_id', 'cell_id'], how='left')

        # 2. Math Calculations 
        site_lat = grid_with_msi_file['site_latitude'].astype(np.float64).to_numpy()
        site_lng = grid_with_msi_file['site_longitude'].astype(np.float64).to_numpy()
        grid_lat = grid_with_msi_file['latitude'].astype(np.float64).to_numpy()
        grid_lng = grid_with_msi_file['longitude'].astype(np.float64).to_numpy()

        grid_with_msi_file['bearing'] = cal_bearing(site_lat, site_lng, grid_lat, grid_lng)
        grid_with_msi_file['distance'] = cal_distance(site_lat, site_lng, grid_lat, grid_lng)
        grid_with_msi_file['tx_height'] = grid_with_msi_file['ant_height'] + 0
        grid_with_msi_file['rx_height'] = 1.5 + 0
        
        # Adding modulo 360 to ensure we don't crash on NaNs
        grid_with_msi_file['beam_azimuth'] = (grid_with_msi_file['physical_azimuth'] + grid_with_msi_file['diff_azimuth']) % 360
        grid_with_msi_file['relative_azimuth'] = grid_with_msi_file['bearing'] - grid_with_msi_file['beam_azimuth']
        grid_with_msi_file['relative_azimuth'] = grid_with_msi_file['relative_azimuth'] % 360
        grid_with_msi_file['relative_azimuth'] = np.where(
            grid_with_msi_file['relative_azimuth'] < 180,
            grid_with_msi_file['relative_azimuth'],
            grid_with_msi_file['relative_azimuth'] - 360
        )

        grid_with_msi_file['distance'] = grid_with_msi_file['distance'].replace(0, 1e-9)

        diff_height = grid_with_msi_file['tx_height'] - grid_with_msi_file['rx_height']
        theta = np.arctan(diff_height / grid_with_msi_file['distance']) * 180 / np.pi
        grid_with_msi_file['relative_tilt'] = theta + grid_with_msi_file['m_tilt'] + grid_with_msi_file['e_tilt']

        # 3. Calculate Gain
        mask = grid_with_msi_file['msi_file_path'].notna()
        grid_with_msi_file.loc[mask, 'gain_3D'] = grid_with_msi_file[mask].apply(
            lambda row: msi_antenna_catalog.get_gain_3D(
                row['msi_file_path'],
                row['relative_tilt'],
                row['relative_azimuth']
            ),
            axis=1
        )
        grid_with_msi_file['path_loss'] = (grid_with_msi_file['rspwr'] + grid_with_msi_file['gain_3D']) - grid_with_msi_file['mean_rsrp']

        # 4. Strict Filtering for SPM Math!
        # Create a new dataframe exclusively for the SciPy curve fitting
        analysis_ready_df = grid_with_msi_file.dropna(subset=['path_loss', 'distance', 'tx_height', 'rx_height']).copy()
        
        # Very important: Drop any Infinity values created by zero division before reaching Scipy
        analysis_ready_df = analysis_ready_df[np.isfinite(analysis_ready_df['path_loss']) & np.isfinite(analysis_ready_df['distance'])]
        
        analysis_ready_df = analysis_ready_df[
            (analysis_ready_df['path_loss'] > 40) & (analysis_ready_df['path_loss'] < 200)
        ]

        # 5. Fallback if no valid points matched the backend
        if analysis_ready_df.empty:
            return jsonify(clean_for_json({
                "rawData": raw_data,
                "neighborData": neighbor_data,
                "gridData": grid_data,
                "analysisMetrics": [],
                "plotData": {},
                "plotData_cell" : {},
                "analysisWarning": "Points displayed, but no valid cell matches found for SPM analysis."
            }))

        metrics_result = []
        plot_data = {}
        plot_data_cell = {}

        # -------------------------------------------------------------
        # SPM MODEL FITTING (NOW USING analysis_ready_df)
        # -------------------------------------------------------------
        frequencies = np.sort(analysis_ready_df['frequency'].unique())

        if len(analysis_ready_df) >= 6:
            parameters = [
                analysis_ready_df['distance'].values.astype(float),
                analysis_ready_df['tx_height'].values.astype(float),
                analysis_ready_df['rx_height'].values.astype(float)
            ]
            PL_measured = analysis_ready_df['path_loss'].values.astype(float)
            try:
                [k1, k2, k3, k4, k5, k6], pcov = curve_fit(path_loss_spm, parameters, PL_measured)
                PL_predicted = path_loss_spm(parameters, k1, k2, k3, k4, k5, k6)
                metric = spm_assess_and_visualize(PL_measured, PL_predicted,
                                                  analysis_ready_df['distance'], analysis_ready_df['tx_height'], analysis_ready_df['rx_height'],
                                                  [k1, k2, k3, k4, k5, k6], '(All frequnecies)')
                
                all_freq_data = analysis_ready_df[['distance', 'path_loss']].sample(n=1000, replace=True) if len(analysis_ready_df) > 1000 else analysis_ready_df[['distance', 'path_loss']]
                scatter_data = [
                    {"x": round(row.distance, 2), "y": round(row.path_loss, 2)} for index, row in all_freq_data.iterrows()
                ]
                min_dist = analysis_ready_df['distance'].min()
                max_dist = analysis_ready_df['distance'].max()
                avg_tx_h = analysis_ready_df['tx_height'].mean()
                avg_rx_h = analysis_ready_df['rx_height'].mean()
                
                distance_line = np.linspace(min_dist, max_dist, 100)
                pl_line_params = [distance_line, np.full_like(distance_line, avg_tx_h), np.full_like(distance_line, avg_rx_h)]
                pl_line = path_loss_spm(pl_line_params, k1, k2, k3, k4, k5, k6)
                
                line_data = [
                    {"x": round(d, 2), "y": round(pl, 2)} for d, pl in zip(distance_line, pl_line)
                ]
                
                plot_data['All Frequencies'] = {
                    "scatter": scatter_data,
                    "line": line_data
                }
                
                metrics_result.append({
                    'Type': 'All Frequencies',
                    'Number of SPM Equations': 1,
                    'MAE (dB)': metric['mae'],
                    'RMSE (dB)': metric['rmse']
                })
            except RuntimeError:
                pass

        for frequency in frequencies:
            freq_df = analysis_ready_df[analysis_ready_df['frequency'] == frequency]
            if freq_df.empty or len(freq_df) < 6:
                continue
                
            parameters = [ freq_df['distance'].values.astype(float), freq_df['tx_height'].values.astype(float), freq_df['rx_height'].values.astype(float) ]
            PL_measured = freq_df['path_loss'].values.astype(float)
            
            try:
                [k1, k2, k3, k4, k5, k6], pcov = curve_fit(path_loss_spm, parameters, PL_measured)
                PL_predicted = path_loss_spm(parameters, k1, k2, k3, k4, k5, k6)
                metric = spm_assess_and_visualize(PL_measured, PL_predicted,
                                                  freq_df['distance'], freq_df['tx_height'], freq_df['rx_height'],
                                                  [k1, k2, k3, k4, k5, k6], f'in {frequency}MHz')
                
                freq_key = f'{frequency}MHz'
                freq_data = freq_df[['distance', 'path_loss']].sample(n=1000, replace=True) if len(freq_df) > 1000 else freq_df[['distance', 'path_loss']]
                scatter_data = [
                    {"x": round(row.distance, 2), "y": round(row.path_loss, 2)} for index, row in freq_data.iterrows()
                ]
                min_dist = freq_df['distance'].min()
                max_dist = freq_df['distance'].max()
                avg_tx_h = freq_df['tx_height'].mean()
                avg_rx_h = freq_df['rx_height'].mean()
                
                distance_line = np.linspace(min_dist, max_dist, 100)
                pl_line_params = [distance_line, np.full_like(distance_line, avg_tx_h), np.full_like(distance_line, avg_rx_h)]
                pl_line = path_loss_spm(pl_line_params, k1, k2, k3, k4, k5, k6)
                
                line_data = [
                    {"x": round(d, 2), "y": round(pl, 2)} for d, pl in zip(distance_line, pl_line)
                ]
                
                plot_data[freq_key] = {
                    "scatter": scatter_data,
                    "line": line_data
                }
                metrics_result.append({
                    'Type': f'Frequency: {frequency}MHz',
                    'Number of SPM Equations': 1,
                    'MAE (dB)': metric['mae'],
                    'RMSE (dB)': metric['rmse']
                })
            except RuntimeError:
                pass
        
        cellnames = np.sort(analysis_ready_df['cell_name'].unique())
        
        for cellname in cellnames:
            cell_df = analysis_ready_df[analysis_ready_df['cell_name'] == cellname]
            
            if cell_df.empty or len(cell_df) < 6:
                continue

            parameters = [ cell_df['distance'].values.astype(float), cell_df['tx_height'].values.astype(float), cell_df['rx_height'].values.astype(float) ]
            PL_measured = cell_df['path_loss'].values.astype(float)
            
            try:
                [k1, k2, k3, k4, k5, k6], pcov = curve_fit(path_loss_spm, parameters, PL_measured)
                PL_predicted = path_loss_spm(parameters, k1, k2, k3, k4, k5, k6)
                metric = spm_assess_and_visualize(PL_measured, PL_predicted,
                                                  cell_df['distance'], cell_df['tx_height'], cell_df['rx_height'],
                                                  [k1, k2, k3, k4, k5, k6], f'in {cellname}')
                cell_key = cellname
                cell_data = cell_df[['distance', 'path_loss']].sample(n=1000, replace=True) if len(cell_df) > 1000 else cell_df[['distance', 'path_loss']]
                scatter_data = [
                    {"x": round(row.distance, 2), "y": round(row.path_loss, 2)} for index, row in cell_data.iterrows()
                ]
                min_dist = cell_df['distance'].min()
                max_dist = cell_df['distance'].max()
                avg_tx_h = cell_df['tx_height'].mean()
                avg_rx_h = cell_df['rx_height'].mean()
                
                distance_line = np.linspace(min_dist, max_dist, 100)
                pl_line_params = [distance_line, np.full_like(distance_line, avg_tx_h), np.full_like(distance_line, avg_rx_h)]
                pl_line = path_loss_spm(pl_line_params, k1, k2, k3, k4, k5, k6)
                
                line_data = [
                    {"x": round(d, 2), "y": round(pl, 2)} for d, pl in zip(distance_line, pl_line)
                ]
                
                plot_data_cell[cell_key] = {
                    "scatter": scatter_data,
                    "line": line_data
                }
                metrics_result.append({
                    'Type': f'Cell: {cellname}',
                    'Number of SPM Equations': 1,
                    'MAE (dB)': metric['mae'],
                    'RMSE (dB)': metric['rmse']
                })
            except RuntimeError:
                pass
            
        response_data = {
            "rawData": raw_data,
            "neighborData": neighbor_data,
            "gridData": grid_data,
            "analysisMetrics": metrics_result,
            "plotData": plot_data, 
            "plotData_cell" : plot_data_cell
        }
        
        cleaned_data = clean_for_json(response_data)
        return jsonify(cleaned_data)

    except Exception as e:
        import traceback
        print(f"An error occurred during processing: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": f"An error occurred during processing: {str(e)}"}), 500
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)