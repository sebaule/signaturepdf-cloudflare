<?php
// Rend un gabarit PHP de site/templates en HTML statique pour une langue donnée.
// Usage : php -n build/render.php <lang> <page> <fichier_sortie>
// (php -n : sans l'extension gettext, on fournit notre propre _() lue depuis les .po)

$lang = $argv[1] ?? 'fr';
$page = $argv[2] ?? 'signature';
$out  = $argv[3] ?? null;

$root = dirname(__DIR__);
$site = $root . '/site';

function parse_po($file) {
    $map = [];
    if (!is_file($file)) return $map;
    $lines = file($file, FILE_IGNORE_NEW_LINES);
    $cur = null; $id = null; $str = null; $fuzzy = false; $flagFuzzy = false; $ctx = null;
    $flush = function () use (&$map, &$id, &$str, &$fuzzy, &$ctx) {
        if ($id !== null && $str !== null && $str !== '' && $id !== '' && !$fuzzy && $ctx === null) {
            $map[$id] = $str;
        }
        $id = null; $str = null; $fuzzy = false; $ctx = null;
    };
    $unq = function ($s) {
        $s = trim($s);
        if ($s === '' || $s[0] !== '"') return '';
        $s = substr($s, 1, -1);
        return strtr($s, ['\\n' => "\n", '\\t' => "\t", '\\"' => '"', '\\\\' => '\\']);
    };
    foreach ($lines as $line) {
        if (strncmp($line, '#,', 2) === 0 && strpos($line, 'fuzzy') !== false) { $flagFuzzy = true; continue; }
        if (strncmp($line, '#', 1) === 0) continue;
        if (strncmp($line, 'msgctxt', 7) === 0) { $flush(); $ctx = $unq(substr($line, 7)); $cur = 'ctx'; continue; }
        if (strncmp($line, 'msgid_plural', 12) === 0) { $cur = 'plural'; continue; }
        if (strncmp($line, 'msgid', 5) === 0) {
            if ($cur === 'str' || $cur === 'plural') { $c = $ctx; $flush(); $ctx = null; }
            $id = $unq(substr($line, 5)); $cur = 'id'; $fuzzy = $flagFuzzy; $flagFuzzy = false; continue;
        }
        if (strncmp($line, 'msgstr[', 7) === 0) { $cur = 'plural'; continue; }
        if (strncmp($line, 'msgstr', 6) === 0) { $str = $unq(substr($line, 6)); $cur = 'str'; continue; }
        if (trim($line) === '') { continue; }
        if ($line[0] === '"') {
            $v = $unq($line);
            if ($cur === 'id') $id .= $v; elseif ($cur === 'str') $str .= $v;
        }
    }
    $flush();
    return $map;
}

$GLOBALS['__po'] = parse_po("$site/locale/$lang/application.po");
function _($s) {
    $m = $GLOBALS['__po'];
    return (isset($m[$s]) && $m[$s] !== '') ? $m[$s] : $s;
}

class Flash { static function instance() { return new self; } function hasKey($k) { return false; } function getKey($k) { return null; } }
class OCR { static function isInstalled() { return false; } }

$supported = [
    'ar' => 'العربية', 'de' => 'Deutsch', 'en' => 'English', 'es' => 'Español',
    'eu' => 'Euskara', 'fr' => 'Français', 'it' => 'Italiano', 'gl' => 'Galego',
    'kab' => 'Taqbaylit', 'nl' => 'Nederlands', 'oc' => 'Occitan', 'pl' => 'Polski',
    'ro' => 'Română', 'ta' => 'தமிழ்', 'tr' => 'Türkçe',
];

$build = getenv('BUILD_ID') ?: 'cf1';
$vars = [
    'TRANSLATION_LANGUAGE' => $lang,
    'DIRECTION_LANGUAGE'   => $lang === 'ar' ? 'rtl' : 'ltr',
    'REVERSE_PROXY_URL'    => '',
    'ROOT'                 => $site,
    'COMMIT'               => $build,
    'SOURCE_URL'           => getenv('SOURCE_URL') ?: 'https://github.com/24eme/signaturepdf',
    'PDF_DEMO_LINK'        => $lang === 'ar' ? '/demo/document_ar.pdf' : '/demo/document.pdf',
    'PDF_STORAGE_ENCRYPTION' => true,
    'disableOrganization'  => false,
    'SUPPORTED_LANGUAGES'  => $supported,
    'IS_ADMIN'             => false,
    'ALIAS'                => '',
    'maxSize'              => 20 * 1000 * 1000,
    'maxPage'              => 100,
    'activeTab'            => 'index',
];

$map = [
    'index'            => ['index.html.php',        ['activeTab' => 'index']],
    'signature'        => ['signature.html.php',    ['activeTab' => 'sign']],
    'signature-shared' => ['signature.html.php',    ['activeTab' => 'sign', 'hash' => 'HASH', 'isPdfEncrypted' => true]],
    'organization'     => ['organization.html.php', ['activeTab' => 'organize']],
    'metadata'         => ['metadata.html.php',     ['activeTab' => 'metadata']],
    'shares'           => ['shares.html.php',       ['activeTab' => 'shares']],
];
if (!isset($map[$page])) { fwrite(STDERR, "page inconnue: $page\n"); exit(1); }

[$tpl, $extra] = $map[$page];
$vars = array_merge($vars, $extra);

chdir("$site/templates");
set_include_path("$site/templates" . PATH_SEPARATOR . get_include_path());

function render($tpl, $vars) {
    extract($vars);
    ob_start();
    include $tpl;
    return ob_get_clean();
}
$html = render($tpl, $vars);
if ($out) {
    @mkdir(dirname($out), 0777, true);
    file_put_contents($out, $html);
} else {
    echo $html;
}
