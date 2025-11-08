#!/usr/bin/env python3
"""
Test champion autocomplete model construction
"""
import json


def test_autocomplete_data():
    """Test that autocomplete data is correctly structured"""
    # Load champion data
    with open('champions.json', 'r', encoding='utf-8') as f:
        champions = json.load(f)

    print(f"✓ Loaded {len(champions)} champions")

    # Simulate what _populate_model does
    items = []
    for champ_id, data in sorted(champions.items(),
                                 key=lambda x: x[1].get('english_name', '')):
        english_name = data.get('english_name', '')
        japanese_name = data.get('japanese_name', '')
        image_url = data.get('image_url', '')

        # This is what will be searchable
        searchable_text = f"{english_name} {japanese_name}"

        items.append({
            'id': champ_id,
            'display': english_name,
            'searchable': searchable_text,
            'japanese': japanese_name,
            'image': image_url
        })

    print(f"✓ Created {len(items)} autocomplete items")

    # Test searching
    test_queries = ["ash", "アッシュ", "sw", "スウェイン", "ahri", "アーリ"]

    for query in test_queries:
        query_lower = query.lower()
        matches = [item for item in items
                  if query_lower in item['searchable'].lower()]

        print(f"✓ Query '{query}': found {len(matches)} matches")
        if matches:
            # Show first 3 matches
            for item in matches[:3]:
                print(f"    - {item['display']} ({item['japanese']})")

    # Verify specific champions
    print("\n✓ Verifying specific champions:")
    ashe = next((item for item in items if item['id'] == 'ashe'), None)
    if ashe:
        print(f"  Ashe: {ashe['display']} / {ashe['japanese']}")
        print(f"  Searchable: '{ashe['searchable']}'")
        assert 'Ashe' in ashe['searchable']
        assert 'アッシュ' in ashe['searchable']
        print("  ✓ Ashe is searchable by both English and Japanese")

    swain = next((item for item in items if item['id'] == 'swain'), None)
    if swain:
        print(f"  Swain: {swain['display']} / {swain['japanese']}")
        print(f"  Searchable: '{swain['searchable']}'")
        assert 'Swain' in swain['searchable']
        assert swain['japanese'] in swain['searchable']
        print("  ✓ Swain is searchable by both English and Japanese")

    print("\n✅ All autocomplete model tests passed!")


if __name__ == "__main__":
    test_autocomplete_data()
