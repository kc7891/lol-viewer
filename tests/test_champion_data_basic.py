#!/usr/bin/env python3
"""
Basic test for champion_data module (no GUI required)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_champion_data_module():
    """Test ChampionData class basic functionality"""
    # Import only the data loading part
    with open(os.path.join(_ROOT, 'champions.json'), 'r', encoding='utf-8') as f:
        champions = json.load(f)

    print(f"[OK] Loaded {len(champions)} champions")

    # Test search functionality manually
    def search_champions(champions, query):
        """Simple search function"""
        query_lower = query.lower()
        matches = []
        for champ_id, data in champions.items():
            english_name = data.get('english_name', '').lower()
            japanese_name = data.get('japanese_name', '').lower()
            if (query_lower in english_name or
                query_lower in japanese_name or
                query_lower in champ_id):
                matches.append({
                    'id': champ_id,
                    'english_name': data.get('english_name', ''),
                    'japanese_name': data.get('japanese_name', ''),
                })
        return matches

    # Test English name search
    results = search_champions(champions, "ashe")
    assert len(results) > 0, "English name search failed"
    assert any(r['id'] == 'ashe' for r in results), "Ashe not found in English search"
    print(f"[OK] English name search works: found {len(results)} results for 'ashe'")

    # Test Japanese name search
    results = search_champions(champions, "アッシュ")
    assert len(results) > 0, "Japanese name search failed"
    assert any('アッシュ' in r['japanese_name'] for r in results), "Japanese name not found"
    print(f"[OK] Japanese name search works: found {len(results)} results for 'アッシュ'")

    # Test partial match
    results = search_champions(champions, "ash")
    assert len(results) > 0, "Partial match search failed"
    print(f"[OK] Partial match search works: found {len(results)} results for 'ash'")

    # Test champion data structure
    ashe = champions.get('ashe')
    assert ashe is not None, "Ashe not found in champions"
    assert 'english_name' in ashe, "english_name field missing"
    assert 'japanese_name' in ashe, "japanese_name field missing"
    assert 'image_url' in ashe, "image_url field missing"
    assert 'id' in ashe, "id field missing"
    print(f"[OK] Champion data structure is correct")

    # Display some sample data
    print("\nSample champion data:")
    for i, (champ_id, data) in enumerate(list(champions.items())[:5]):
        print(f"  {champ_id}: {data['english_name']} / {data['japanese_name']}")

    print("\n[OK] All basic tests passed!")


def test_wukong_uses_wukong_key_and_monkeyking_only_for_data_dragon():
    """Wukong is keyed "wukong" (app/URLs/CSV); "MonkeyKing" stays only as the Data Dragon id.

    The weekly update-champions workflow and scripts/fetch_champions.py must both
    rename the key, otherwise lolalytics URLs 404 and the CSV lane scores don't match.
    """
    with open(os.path.join(_ROOT, 'champions.json'), 'r', encoding='utf-8') as f:
        champions = json.load(f)

    assert 'monkeyking' not in champions
    wukong = champions['wukong']
    assert wukong['english_name'] == 'Wukong'
    assert wukong['id'] == 'MonkeyKing'
    assert wukong['image_url'].endswith('/img/champion/MonkeyKing.png')
    assert wukong['lanes']['jg'] == 5  # jungle (changed 2026-11-23, decisions.md M-024)


if __name__ == "__main__":
    test_champion_data_module()
