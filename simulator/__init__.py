"""Desk stand-in for the bench ESP32.

Publishes the same MQTT JSON the real board would: two temperatures on
hvac/bench/reading every 10 seconds. Use this until the ESP32 is flashed.
If the live page never moves, run `python -m simulator` in a third terminal
after Mosquitto and `python -m hub`.
"""
