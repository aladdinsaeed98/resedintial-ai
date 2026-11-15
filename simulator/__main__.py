"""Start the bench publisher from `python -m simulator`.

This is only an entry point. The loop and MQTT client live in
bench_publisher.py. Needs a broker on 127.0.0.1:1883 (or --host/--port).
"""

from simulator.bench_publisher import main

main()
