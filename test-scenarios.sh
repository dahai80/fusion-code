#!/bin/bash
# Comprehensive scenario test for fusion-code + MLX
# Focus: memory leaks, brand consistency, UX quality

export FUSION_MLX_ENABLED=1
export FUSION_MLX_API_KEY=dahai168
export FUSION_MLX_MODEL=Qwen3.6-27B-mxfp8

FC="./fusion-code-dev"
LOG_DIR="/tmp/fusion-code-scenario-test"
mkdir -p "$LOG_DIR"

run_test() {
    local name="$1"
    local prompt="$2"
    local timeout_sec="${3:-90}"
    local log_out="$LOG_DIR/${name}.out"
    local log_err="$LOG_DIR/${name}.err"

    local start_mem=$(ps aux | grep "[f]usion-mlx" | awk '{sum+=$6}END{print sum}')

    echo -n "  [$name] ... "
    timeout $timeout_sec $FC -p "$prompt" > "$log_out" 2> "$log_err"
    local exit_code=$?

    local end_mem=$(ps aux | grep "[f]usion-mlx" | awk '{sum+=$6}END{print sum}')

    if [ $exit_code -eq 124 ]; then
        echo "TIMEOUT"
    elif [ $exit_code -ne 0 ]; then
        echo "EXIT($exit_code)"
    else
        echo "OK"
    fi

    # Memory delta
    if [ -n "$start_mem" ] && [ -n "$end_mem" ]; then
        delta=$((end_mem - start_mem))
        echo "    MLX mem: ${start_mem}KB -> ${end_mem}KB (delta: ${delta}KB)"
    fi

    # Output preview (strip ANSI)
    local preview=$(cat "$log_out" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | sed 's/\x1b\][^\x07]*\x07//g' | sed 's/\x1b\[?[0-9]*[hl]//g' | tr -d '\r' | head -5)
    if [ -n "$preview" ]; then
        echo "    Preview: $(echo "$preview" | head -1 | cut -c1-100)"
    fi
}

echo "============================================"
echo " Fusion-Code Scenario Test Suite"
echo " Model: $FUSION_MLX_MODEL"
echo " Time: $(date)"
echo "============================================"
echo ""

echo "=== 1. Basic Commands ==="
run_test "01_version" "/version" 15
run_test "02_help" "/help" 15
run_test "03_model" "/model" 15
run_test "04_doctor" "/doctor" 30
echo ""

echo "=== 2. Simple Queries ==="
run_test "05_simple_math" "What is 2+2? Reply one word only." 30
run_test "06_simple_zh" "你好，请用一句话介绍你自己。" 30
run_test "07_simple_en" "What is fusion-code? Reply in one sentence." 30
echo ""

echo "=== 3. Tool-Using Queries ==="
run_test "08_read_file" "Read the file CLAUDE.md and summarize it in 3 bullet points." 90
run_test "09_list_files" "List the files in the current directory." 60
run_test "10_search" "Search for 'preflightMlx' in the codebase." 90
echo ""

echo "=== 4. Compact Scenarios ==="
run_test "11_compact" "/compact" 120
echo ""

echo "=== 5. Long Context Scenarios ==="
run_test "12_long_explain" "Explain the concept of transformers in machine learning. Write at least 5 paragraphs." 90
run_test "13_code_gen" "Write a Python function that implements binary search. Include type hints and error handling." 90
echo ""

echo "=== 6. Init Command (Critical OOM Test) ==="
# This is the main bug scenario
INIT_START_MEM=$(ps aux | grep "[f]usion-mlx" | awk '{sum+=$6}END{print sum}')
echo "  [14_init] Starting /init test (MLX mem before: ${INIT_START_MEM}KB)..."
timeout 120 $FC -p "/init" > "$LOG_DIR/14_init.out" 2> "$LOG_DIR/14_init.err"
INIT_EXIT=$?
INIT_END_MEM=$(ps aux | grep "[f]usion-mlx" | awk '{sum+=$6}END{print sum}')
echo "  [14_init] Exit: $INIT_EXIT, MLX mem after: ${INIT_END_MEM}KB"
if [ -n "$INIT_START_MEM" ] && [ -n "$INIT_END_MEM" ]; then
    delta=$((INIT_END_MEM - INIT_START_MEM))
    echo "    Memory delta: ${delta}KB ($((delta/1024))MB)"
    if [ $delta -gt 5242880 ]; then
        echo "    ⚠️  WARNING: >5GB memory increase!"
    elif [ $delta -gt 1048576 ]; then
        echo "    ⚠️  WARNING: >1GB memory increase!"
    fi
fi
echo ""

echo "=== 7. Multi-Step Complex Scenario ==="
run_test "15_complex" "Find all TypeScript files in src/utils/model/, then read mlxPreflight.ts and explain what it does." 120
echo ""

echo "============================================"
echo " Post-Test Analysis"
echo "============================================"
echo ""

# Brand check
echo "--- Brand Consistency ---"
BRAND_ISSUES=0
for f in $LOG_DIR/*.out; do
    clean=$(cat "$f" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | sed 's/\x1b\][^\x07]*\x07//g')
    if echo "$clean" | grep -qi "claude code\|I'm Claude\|I am Claude\|by Anthropic"; then
        echo "⚠️  BRAND ISSUE in $(basename $f):"
        echo "$clean" | grep -in "claude code\|I'm Claude\|I am Claude\|by Anthropic" | head -3
        BRAND_ISSUES=$((BRAND_ISSUES + 1))
    fi
done
if [ $BRAND_ISSUES -eq 0 ]; then
    echo "✅ No brand issues found"
fi
echo ""

# Memory check
echo "--- Memory Status ---"
FINAL_MEM=$(ps aux | grep "[f]usion-mlx" | awk '{sum+=$6}END{print sum}')
if [ -n "$FINAL_MEM" ]; then
    MEM_GB=$(echo "scale=2; $FINAL_MEM / 1024 / 1024" | bc)
    echo "Final MLX memory: ${MEM_GB}GB"
fi
echo ""

# Error check
echo "--- Error Patterns ---"
ERR_COUNT=0
for f in $LOG_DIR/*.err; do
    if [ -s "$f" ]; then
        errs=$(grep -ic "OOM\|out of memory\|memory limit\|killed\|SEGFAULT\|fatal" "$f" 2>/dev/null || true)
        if [ "$errs" -gt 0 ]; then
            echo "⚠️  Errors in $(basename $f) ($errs issues):"
            grep -i "OOM\|out of memory\|memory limit\|killed\|SEGFAULT\|fatal" "$f" | head -3
            ERR_COUNT=$((ERR_COUNT + errs))
        fi
    fi
done
if [ $ERR_COUNT -eq 0 ]; then
    echo "✅ No critical errors found"
fi
echo ""

# Output quality check
echo "--- Output Quality ---"
for name in 05_simple_math 06_simple_zh 07_simple_en 12_long_explain 13_code_gen; do
    f="$LOG_DIR/${name}.out"
    if [ -f "$f" ]; then
        clean=$(cat "$f" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | sed 's/\x1b\][^\x07]*\x07//g' | tr -d '\r' | grep -v '^$')
        lines=$(echo "$clean" | wc -l | tr -d ' ')
        chars=$(echo "$clean" | wc -c | tr -d ' ')
        echo "  $name: ${lines} lines, ${chars} chars"
    fi
done

echo ""
echo "=== Test Complete ==="
