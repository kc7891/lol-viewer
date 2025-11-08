#!/usr/bin/env python3
"""
Simple test program to verify QCompleter is working
"""
import sys
from PyQt6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLineEdit, QLabel
from PyQt6.QtCore import Qt
from champion_data import ChampionData, setup_champion_input


class TestWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Autocomplete Test")
        self.resize(500, 200)

        layout = QVBoxLayout(self)

        # Instructions
        label = QLabel("Type a champion name (English or Japanese):")
        layout.addWidget(label)

        # Input field
        self.input = QLineEdit()
        self.input.setPlaceholderText("e.g., ashe, アッシュ, swain")
        layout.addWidget(self.input)

        # Result label
        self.result_label = QLabel("")
        layout.addWidget(self.result_label)

        # Set up champion data and autocomplete
        print("=" * 60)
        print("INITIALIZING AUTOCOMPLETE")
        print("=" * 60)

        self.champion_data = ChampionData()

        if len(self.champion_data.champions) > 0:
            setup_champion_input(self.input, self.champion_data)
            self.input.textChanged.connect(self.on_text_changed)
            print("\n✓ Autocomplete setup complete")
        else:
            print("\n✗ No champion data available!")
            self.result_label.setText("ERROR: No champion data loaded!")

    def on_text_changed(self, text):
        """Handle text changes"""
        if text:
            matches = self.champion_data.search(text)
            self.result_label.setText(f"Found {len(matches)} matches for '{text}'")
            print(f"[Text changed] '{text}' -> {len(matches)} matches")


def main():
    app = QApplication(sys.argv)
    window = TestWindow()
    window.show()

    print("\n" + "=" * 60)
    print("APPLICATION STARTED")
    print("Try typing 'ash' or 'アッシュ' in the input field")
    print("=" * 60 + "\n")

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
