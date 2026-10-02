    """Train-like window → ok report, no drift, no retraining recommendation.

    A systematic every-5th-row sample (189 rows) keeps the neighborhood mix of
    the train split — a small random sample skews the neighborhood-level
    features and drifts for real.
    """
    sample = train_feature_frame.iloc[::5]
    log = _write_synthetic_log(tmp_path / "predictions.jsonl", sample)
    output = tmp_path / "drift" / "latest.json"
    report = run_drift_check(log_path=log, window=500, output_path=output)

    # latest.json structure (SPEC §10 report contract).
    assert set(report) == {
        "timestamp",
        "window",
        "log_path",
        "psi_threshold",
        "warn_threshold",
        "min_sample_for_retraining",
        "reference_feature_version",
        "n_invalid_lines",
        "status",
        "n_predictions",
        "low_sample",
        "drift_detected",
        "drifted_features",
        "calendar_drift_features",
        "degenerate_features",
        "warn_features",
        "per_feature_psi",
        "max_psi",
        "prediction_psi",
        "retraining_recommended",
        "recommendation_text",
    }
    assert report["status"] == "ok"
    assert report["n_predictions"] == len(sample)