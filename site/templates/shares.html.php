<!doctype html>
<html lang="<?php echo $TRANSLATION_LANGUAGE ?>" dir="<?php echo $DIRECTION_LANGUAGE ?>" style="direction: <?php echo $DIRECTION_LANGUAGE ?>;">
<head>
    <?php include('components/header.html.php'); ?>
    <title>Signature PDF - Mes partages</title>
    <meta name="robots" content="noindex">
</head>
<body>
<noscript>
    <div class="alert alert-danger text-center" role="alert">
        <i class="bi bi-exclamation-triangle"></i> <?php echo _("Site not functional without JavaScript enabled");  ?>
    </div>
</noscript>
<?php include('components/navtab.html.php'); ?>
<div class="container pt-3 fullpage" style="max-width: 1000px;">
    <h1 class="h4"><i class="bi bi-people-fill"></i> <span data-cfx="shares_title"></span></h1>
    <p class="text-muted small" data-cfx="shares_help"></p>
    <div id="shares-error" class="alert alert-warning d-none"></div>
    <div id="shares-empty" class="alert alert-light border d-none" data-cfx="shares_empty"></div>
    <div id="shares-list" class="row g-3"></div>
</div>
<?php include('components/footer.html.php'); ?>
<?php include('components/common.html.php'); ?>
<script src="<?php echo $REVERSE_PROXY_URL; ?>/js/cf-share.js?<?php echo $COMMIT ?>"></script>
<script src="<?php echo $REVERSE_PROXY_URL; ?>/js/cf-shares.js?<?php echo $COMMIT ?>"></script>
</body>
</html>
