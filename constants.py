#!/usr/bin/env python3
"""
LoL Viewer - Constants, URL templates, and UI size configuration.
"""

__version__ = "0.28.4"

# Default analytics URLs
DEFAULT_BUILD_URL = "https://lolalytics.com/lol/{name}/build/"
DEFAULT_COUNTER_URL = "https://lolalytics.com/lol/{name}/counters/"
DEFAULT_MATCHUP_URL = (
    "https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/"
    "?lane={lane_name}&vslane={lane_name}"
)
DEFAULT_ARAM_URL = "https://u.gg/lol/champions/aram/{name}-aram"
DEFAULT_LIVE_GAME_URL = "https://u.gg/lol/lg-splash"

# UI glyphs
# Keep these consistent across the app to avoid subtle visual mismatches.
CLOSE_BUTTON_GLYPH = "×"

# Feature flags (toggle in Settings page).
# NOTE: Keys are persisted via QSettings at "feature_flags/<key>".
#
# This build currently ships with no gated/experimental features.
FEATURE_FLAG_DEFINITIONS: dict = {}

# Queue IDs used to detect ARAM / ARAM: Mayhem.
# - ARAM (Howling Abyss): 450 (current), plus a few legacy/special variants.
# - ARAM: Mayhem queue IDs are not present in Riot's static queues.json; these IDs
#   are confirmed from CommunityDragon queue metadata:
#   https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json
ARAM_QUEUE_IDS = {450, 65, 100, 720}
ARAM_MAYHEM_QUEUE_IDS = {2400, 2401, 2403, 2405, 3240, 3270}

# ── UI size presets ──
# Each preset defines all tuneable size/spacing tokens used across the UI.
# "small" preserves the original hard-coded values; "medium" and "large" scale
# them up for users who prefer bigger controls.
UI_SIZE_PRESETS = {
    "small": {
        "font_base": "9pt",
        "font_small": "8pt",
        "font_title": "11pt",
        "font_section": "12pt",
        "font_page_title": "18pt",
        "font_pill": "9pt",
        "font_mode_btn": "9pt",
        "font_selector_item": "9pt",
        "font_lane_item": "10pt",
        "font_settings_input": "10pt",
        "font_settings_label": "10pt",
        "font_settings_desc": "9pt",
        "font_settings_version": "11pt",
        "font_sidebar_item": "12px",
        "font_sidebar_type": "9px",
        "font_matchup_title": "8pt",
        "font_matchup_name": "9pt",
        "padding_btn": "4px 10px",
        "padding_pill": "3px 8px 3px 4px",
        "padding_primary_btn": "8px 16px",
        "padding_search": "6px 8px",
        "padding_selector_item": "5px 8px",
        "padding_lane_item": "8px 12px",
        "padding_settings_input": "8px",
        "icon_size_header": 28,
        "icon_size_sidebar": 30,
        "icon_size_selector": 28,
        "icon_size_pill": 20,
        "icon_size_matchup": 24,
        "icon_size_sidebar_btn": 20,
        "icon_size_close_btn": 24,
        "font_sidebar_btn": "14px",
        "font_close_btn": "16px",
        "height_control_bar": 36,
        "height_header": 44,
        "height_lcu_status": 48,
        "height_matchup_row": 33,
        "height_matchup_title": 24,
        "width_matchup_lane": 44,
        "height_dot_container": 30,
        "width_dot_indicator": 10,
        "height_dot_indicator": 30,
        "width_tab_dot_indicator": 8,
        "height_tab_dot_indicator": 8,
        "icon_size_checkbox": 16,
        "min_width_combobox": 100,
        "height_matchup_btn": 18,
        "border_radius": "4px",
        "border_radius_lg": "6px",
        "margin_mode_btn": "3px 2px",
    },
    "medium": {
        "font_base": "11pt",
        "font_small": "10pt",
        "font_title": "13pt",
        "font_section": "14pt",
        "font_page_title": "22pt",
        "font_pill": "11pt",
        "font_mode_btn": "11pt",
        "font_selector_item": "11pt",
        "font_lane_item": "12pt",
        "font_settings_input": "12pt",
        "font_settings_label": "12pt",
        "font_settings_desc": "11pt",
        "font_settings_version": "13pt",
        "font_sidebar_item": "14px",
        "font_sidebar_type": "11px",
        "font_matchup_title": "10pt",
        "font_matchup_name": "11pt",
        "padding_btn": "5px 12px",
        "padding_pill": "4px 10px 4px 5px",
        "padding_primary_btn": "10px 20px",
        "padding_search": "7px 10px",
        "padding_selector_item": "6px 10px",
        "padding_lane_item": "10px 14px",
        "padding_settings_input": "10px",
        "icon_size_header": 34,
        "icon_size_sidebar": 36,
        "icon_size_selector": 34,
        "icon_size_pill": 24,
        "icon_size_matchup": 28,
        "icon_size_sidebar_btn": 24,
        "icon_size_close_btn": 28,
        "font_sidebar_btn": "17px",
        "font_close_btn": "19px",
        "height_control_bar": 42,
        "height_header": 52,
        "height_lcu_status": 56,
        "height_matchup_row": 40,
        "height_matchup_title": 28,
        "width_matchup_lane": 52,
        "height_dot_container": 36,
        "width_dot_indicator": 12,
        "height_dot_indicator": 36,
        "width_tab_dot_indicator": 10,
        "height_tab_dot_indicator": 10,
        "icon_size_checkbox": 20,
        "min_width_combobox": 120,
        "height_matchup_btn": 22,
        "border_radius": "5px",
        "border_radius_lg": "7px",
        "margin_mode_btn": "4px 3px",
    },
    "large": {
        "font_base": "13pt",
        "font_small": "11pt",
        "font_title": "15pt",
        "font_section": "17pt",
        "font_page_title": "25pt",
        "font_pill": "13pt",
        "font_mode_btn": "13pt",
        "font_selector_item": "13pt",
        "font_lane_item": "14pt",
        "font_settings_input": "14pt",
        "font_settings_label": "14pt",
        "font_settings_desc": "13pt",
        "font_settings_version": "15pt",
        "font_sidebar_item": "17px",
        "font_sidebar_type": "13px",
        "font_matchup_title": "11pt",
        "font_matchup_name": "13pt",
        "padding_btn": "6px 14px",
        "padding_pill": "5px 12px 5px 6px",
        "padding_primary_btn": "12px 24px",
        "padding_search": "8px 12px",
        "padding_selector_item": "7px 12px",
        "padding_lane_item": "12px 16px",
        "padding_settings_input": "12px",
        "icon_size_header": 40,
        "icon_size_sidebar": 42,
        "icon_size_selector": 40,
        "icon_size_pill": 28,
        "icon_size_matchup": 34,
        "icon_size_sidebar_btn": 28,
        "icon_size_close_btn": 34,
        "font_sidebar_btn": "20px",
        "font_close_btn": "22px",
        "height_control_bar": 50,
        "height_header": 60,
        "height_lcu_status": 64,
        "height_matchup_row": 46,
        "height_matchup_title": 34,
        "width_matchup_lane": 60,
        "height_dot_container": 42,
        "width_dot_indicator": 14,
        "height_dot_indicator": 42,
        "width_tab_dot_indicator": 12,
        "height_tab_dot_indicator": 12,
        "icon_size_checkbox": 24,
        "min_width_combobox": 140,
        "height_matchup_btn": 26,
        "border_radius": "6px",
        "border_radius_lg": "8px",
        "margin_mode_btn": "4px 3px",
    },
}


def get_ui_sizes(size_name: str = "medium") -> dict:
    """Return the size preset dict for *size_name* (default ``"small"``)."""
    return UI_SIZE_PRESETS.get(size_name, UI_SIZE_PRESETS["small"])
