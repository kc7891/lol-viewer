#!/usr/bin/env python3
"""
Script to fetch champion data from League of Legends official website
and create a champion dictionary with English names, Japanese names, and image URLs.
"""
import json
import re
import requests
from bs4 import BeautifulSoup


def fetch_champions_from_url(url: str) -> dict:
    """
    Fetch champion data from the given URL.

    Args:
        url: The URL to fetch champion data from

    Returns:
        A dictionary containing champion data extracted from the page
    """
    print(f"Fetching data from {url}...")
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, 'html.parser')

    # Look for script tags containing JSON data
    script_tags = soup.find_all('script')

    for script in script_tags:
        if script.string and 'champions' in script.string.lower():
            # Try to extract JSON data
            script_content = script.string

            # Look for JSON patterns in the script
            # Try to find JSON array or object containing champion data
            json_match = re.search(r'(\[.*?\]|\{.*?\})', script_content, re.DOTALL)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    return data
                except json.JSONDecodeError:
                    continue

    # If we can't find JSON in script tags, try to parse from HTML structure
    print("Could not find JSON data in script tags, attempting alternative method...")

    # Alternative: Look for __NEXT_DATA__ which is commonly used in Next.js apps
    next_data = soup.find('script', {'id': '__NEXT_DATA__'})
    if next_data and next_data.string:
        try:
            data = json.loads(next_data.string)
            return data
        except json.JSONDecodeError:
            pass

    return {}


def extract_champion_list(data: dict, lang: str = 'en') -> dict:
    """
    Extract champion list from the fetched data.

    Args:
        data: The data fetched from the website
        lang: Language code ('en' or 'ja')

    Returns:
        Dictionary mapping champion IDs to their data
    """
    champions = {}

    # Navigate through the data structure to find champions
    # The structure may vary, so we'll search recursively
    def search_champions(obj, path=""):
        if isinstance(obj, dict):
            # Check if this looks like champion data
            if 'id' in obj and 'name' in obj:
                # This might be a champion entry
                champion_id = obj.get('id', '').lower()
                champion_name = obj.get('name', '')

                # Look for image URL
                image_url = None
                if 'image' in obj:
                    if isinstance(obj['image'], dict) and 'url' in obj['image']:
                        image_url = obj['image']['url']
                    elif isinstance(obj['image'], str):
                        image_url = obj['image']

                # Also check for other possible image field names
                for key in ['imageUrl', 'thumbnail', 'portrait', 'splash']:
                    if key in obj and isinstance(obj[key], str):
                        image_url = obj[key]
                        break

                if champion_id and champion_name:
                    champions[champion_id] = {
                        'name': champion_name,
                        'image': image_url
                    }

            # Continue searching in nested objects
            for key, value in obj.items():
                search_champions(value, f"{path}.{key}")

        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                search_champions(item, f"{path}[{i}]")

    search_champions(data)
    return champions


def build_champion_dictionary():
    """
    Build a complete champion dictionary with English names, Japanese names, and images.

    Returns:
        A dictionary mapping English champion names (lowercase) to champion data
    """
    en_url = "https://www.leagueoflegends.com/en-us/champions/"
    ja_url = "https://www.leagueoflegends.com/ja-jp/champions/"

    # Fetch data from both languages
    en_data = fetch_champions_from_url(en_url)
    ja_data = fetch_champions_from_url(ja_url)

    # Extract champion lists
    en_champions = extract_champion_list(en_data, 'en')
    ja_champions = extract_champion_list(ja_data, 'ja')

    print(f"Found {len(en_champions)} champions in English data")
    print(f"Found {len(ja_champions)} champions in Japanese data")

    # Combine the data
    champion_dict = {}

    # If the extraction didn't work well, use a fallback approach
    if len(en_champions) == 0:
        print("Using fallback champion data...")
        champion_dict = get_fallback_champion_data()
    else:
        for champ_id, en_data in en_champions.items():
            ja_name = ja_champions.get(champ_id, {}).get('name', en_data['name'])

            champion_dict[champ_id] = {
                'english_name': en_data['name'],
                'japanese_name': ja_name,
                'image_url': en_data.get('image', ''),
                'id': champ_id
            }

    return champion_dict


def get_fallback_champion_data():
    """
    Fallback champion data if web scraping fails.
    This uses Riot's Data Dragon API which is more reliable.

    Returns:
        A dictionary mapping English champion names (lowercase) to champion data
    """
    print("Fetching champion data from Data Dragon API...")

    # Get latest version
    version_url = "https://ddragon.leagueoflegends.com/api/versions.json"
    versions = requests.get(version_url, timeout=10).json()
    latest_version = versions[0]

    print(f"Latest version: {latest_version}")

    # Get English champion data
    en_url = f"https://ddragon.leagueoflegends.com/cdn/{latest_version}/data/en_US/champion.json"
    en_response = requests.get(en_url, timeout=30)
    en_data = en_response.json()

    # Get Japanese champion data
    ja_url = f"https://ddragon.leagueoflegends.com/cdn/{latest_version}/data/ja_JP/champion.json"
    ja_response = requests.get(ja_url, timeout=30)
    ja_data = ja_response.json()

    champion_dict = {}

    for champ_id, champ_data in en_data['data'].items():
        en_name = champ_data['name']
        ja_name = ja_data['data'].get(champ_id, {}).get('name', en_name)

        # Image URL from Data Dragon
        image_url = f"https://ddragon.leagueoflegends.com/cdn/{latest_version}/img/champion/{champ_id}.png"

        # Use the champion's ID as the key (lowercase)
        key = champ_id.lower()

        champion_dict[key] = {
            'english_name': en_name,
            'japanese_name': ja_name,
            'image_url': image_url,
            'id': champ_id
        }

    return champion_dict


def save_champion_data(champion_dict: dict, output_file: str = "champions.json"):
    """
    Save champion dictionary to a JSON file.

    Args:
        champion_dict: The champion dictionary to save
        output_file: The output file path
    """
    print(f"Saving {len(champion_dict)} champions to {output_file}...")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(champion_dict, f, ensure_ascii=False, indent=2)

    print(f"Champion data saved successfully!")


def main():
    """Main entry point"""
    try:
        champion_dict = build_champion_dictionary()

        # Print some sample data
        print("\nSample champions:")
        for i, (champ_id, data) in enumerate(list(champion_dict.items())[:5]):
            print(f"  {champ_id}: {data['english_name']} / {data['japanese_name']}")
            if i >= 4:
                break

        save_champion_data(champion_dict)

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
