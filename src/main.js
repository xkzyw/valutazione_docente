/**
 *  This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
 *  as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
 *  of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>. 
 */

const express = require("express");
const { MongoClient } = require("mongodb");
const config = require("./config.json");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();

const LISTEN_PORT = config.port;

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

app.use(cors())

const mongodb = new MongoClient(`mongodb://${config.host}:27017/Zhou_ValutazioniDocenti`);

// Verifica se il token è valido e non è scaduto
// Ritorna il valore contenuto nel token nel caso se valido
// Altrimenti ritorna false
function verifyToken(token){
    let res = null;
    jwt.verify(token, config.secret, (err, decoded) => {
        if(err){
            res = false;
        }else{
            res = decoded;
        }
    });

    return res;
}

app.post("/login", (req, res) => {
    let email = req.body.user;
    let passwd = req.body.password;

    mongodb.connect()
        .then(async (mongoclient) => {
            // Risultato da completare e restituire
            let result = {
                token: null,
                email: email,
            };

            // Collecgamento al collection dei utenti e credenziali
            let utenti_collection = mongoclient.db().collection("Utenti");
            let cred_collection = mongoclient.db().collection("Credenziali");

            // Cerco se esiste la credenziale inserito
            let cred = await cred_collection.findOne({email: email, password: passwd}, {
                projection: {
                    _id: 0
                }
            });

            if(!cred){
                res.json({messaggio: "Utente non esistente o password errato"}).end();
                return;
            }

            // Ottengo dal database lo studente con il email assocciato
            let utente = await utenti_collection.findOne({email: email}, {
                projection: {
                    tipo: 1,
                    _id: 0
                }
            });
            
            mongoclient.close();

            // Contenuto del token
            let body = {}

            // Nel caso se email esiste
            if(utente){
                if(utente.tipo == "A"){
                    body.tipo = "A";
                    result.urlEndpoint = "admin_console";
                }else if(utente.tipo == "S"){
                    // result.cognome = studente.cognome;
                    // result.nome = studente.nome;
                    body.tipo = "S";
                    result.urlEndpoint = "get_docenti_classe";
                }else if(utente.tipo == "D"){
                    body.tipo = "D";
                    result.urlEndpoint = "view_docente"
                }
            }else{
                res.json({messaggio: "Utente non esistente o password errato"}).end();
                return;
            }

            // Inserire email nel token
            body.email = result.email;

            // Creao un nuovo token
            let token = jwt.sign(body, config.secret, {
                expiresIn: config.expireTime
            });

            result.token = token;

            res.json(result);
            res.end();
        })

});

app.post("/get_docenti_classe", (req, res) => {
    let token = req.body.token;

    // Ottengo dati dal token
    let data = verifyToken(token);

    // Se token valido
    if(data){
        let {email, tipo} = data;

        // Se non è un studente
        if(tipo != "S"){
            res.json({messaggio: "Riservato allo studente"}).end();
            return;
        }

        mongodb.connect()
            .then(async (mongoclient) => {
                let utenti_collection = mongoclient.db().collection("Utenti");
                let config_collection = mongoclient.db().collection("Config");

                // Configurazione dal db
                let config = await config_collection.find({}, {
                    projection: {
                        _id: 0
                    }
                }).toArray();

                //Parametri di configurazioni salvati nel db
                config = config[0];

                // Se votazione è chiusa
                if(!config.open){
                    res.json({messaggio: "Votazione terminata"}).end();
                    return
                }else{
                    // Lo studente autenticato
                    let studente = await utenti_collection.findOne({email: email}, {
                            projection: {
                                _id: 0,
                                docenti_valutati: 1,
                                classe: 1
                            }
                    });

                    // Tutti i docenti del calsse di questo studente
                    let lista_docenti = await utenti_collection.find({tipo: "D", "classi_materie.nome": studente.classe}).toArray();

                    // Docenti non valutati
                    let non_val = [];

                    // Per ogni docenti dello studente
                    for(let doc of lista_docenti){
                        // Materie valutati dal studenti al docente
                        let mat_val = null;
                        
                        // Se esiste nella lista dei docenti valutati
                        // Per ogni docente valutato dallo studente
                        for(let val_doc of studente.docenti_valutati){
                            // Se il docente è nella lista dei docenti valutati
                            if(doc.email === val_doc.email){
                                mat_val = val_doc.materie_valutati;
                                break;
                            }
                        }

                        // Se non viene trovato 
                        if(!mat_val){

                            // Materia in cui insegna nella classe dello studente
                            let mat = doc.classi_materie.filter((val) => {
                                return val.nome == studente.classe
                            })[0];

                            non_val.push({nome: doc.nome, cognome: doc.cognome, mailDocente: doc.email, materie: mat.materie});
                        }else{
                            // Materia in cui insegna nella classe dello studente
                            let mat = doc.classi_materie.filter((val) => {
                                return val.nome == studente.classe
                            })[0];

                            // Ottenere materie che non sono stati votati dallo studente
                            let diff = mat.materie.filter((element) => !mat_val.includes(element));

                            // Se esiste almeno uno materie che non è stato votato
                            if(diff.length != 0){
                                non_val.push({nome: doc.nome, cognome: doc.cognome, mailDocente: doc.email, materie: diff});
                            }
                        }

                    }

                    res.json({classe: studente.classe, docenti: non_val, email: data.email}).end();
                    mongoclient.close();
                }
            });
    }else{
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return;
    }
});

app.post("/get_domande", (req, res) => {
    let token = req.body.token;

    // Ottengo dati dal token
    let data = verifyToken(token);

    // Se token valido
    if(data){
        let {tipo} = data;

        // Se non è un studente
        if(tipo != "S"){
            res.json({messaggio: "Riservato allo studente"}).end();
        }

    }else{
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return;
    }

    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Domande");

            // Lista di tutti le domande
            let lista_domande = await domande_collection.find({}).toArray();
            mongoclient.close();

            res.json(lista_domande);
            res.end();
        });
});

app.post("/valuta_docente", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(!data){
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return
    } 

    let valutazione = req.body;

    mongodb.connect()
        .then(async (mongoclient) => {
            let voti_collection = mongoclient.db().collection("Voti");
            let utenti_collection = mongoclient.db().collection("Utenti");

            // Parametro per la ricerca del docente interessato
            let doc_param = {email: valutazione.mailDocente}

            // Materia valutato con le relative valutazioni
            let materia = valutazione.materia;

            // docente da valutare
            let docente = await voti_collection.findOne(doc_param);

            // Se non esiste un voto per tale docente inserire un nuovo
            if(!docente){
                await voti_collection.insertOne({
                    email: valutazione.mailDocente,
                    materie: []
                });

                // Docente aggiornato, precedentemente null
                docente = await voti_collection.findOne(doc_param);
            }

            // Se è già votato nel database tale materia  
            let mat = docente.materie.find((materia_valutata) => materia_valutata.nome == materia.nomeMateria);

            if(mat){
                // Per ogni domanda valutato
                materia.valutazioni.forEach((valuta_domanda) => {
                    // Verifico se esiste già la domanda
                    if(mat.valutazioni.find((valutazione_db) => valutazione_db.id_domanda == valuta_domanda.idDomanda)){
                        voti_collection.updateOne(doc_param, {"$push":{
                            "materie.$[mat].valutazioni.$[val].voto": 
                                valuta_domanda.voto
                        }}, {
                            arrayFilters:[
                                {"mat.nome": materia.nomeMateria}, 
                                {"val.id_domanda": valuta_domanda.idDomanda}
                            ]
                        });
                    }else{
                        // Non esiste nel db la domanda da valutare, quindi lo aggiungo
                        voti_collection.updateOne(doc_param, {"$push":{
                            "materie.$[mat].valutazioni": 
                                {
                                    id_domanda: valuta_domanda.idDomanda,
                                    voto: [
                                        valuta_domanda.voto
                                    ]
                                }
                        }}, {
                            arrayFilters:[
                                {"mat.nome": materia.nomeMateria},
                            ]
                        });
                    }
                })
            }else{
                // Non esiste la meteria nel db del docente

                // Creao array delle votazioni
                let tmp = [];

                materia.valutazioni.forEach((valuta_domanda) => {
                    tmp.push({
                        id_domanda: valuta_domanda.idDomanda,
                        voto: [
                            valuta_domanda.voto
                        ]
                    })
                });

                voti_collection.updateOne(doc_param, {"$push":{
                    "materie": 
                        {
                            nome: materia.nomeMateria,
                            valutazioni: tmp
                        }
                }});
            }

            // Lo studente che sta votando
            let studente = await utenti_collection.findOne({email: data.email});

            // Ottengo il stesso docente che sta valutando dal db
            let doc_val = studente.docenti_valutati.find((val) => val.email == valutazione.mailDocente);

            // Se non esiste, significa che non ha mai votato questo docente
            if(!doc_val){
                // Creo un nuovo oggetto docente, tenendo la traccia di quale materia e quale docente ha votato lo studente
                utenti_collection.updateOne({email: data.email}, {$push: {
                    docenti_valutati: {
                        email: valutazione.mailDocente,
                        materie_valutati: [materia.nomeMateria]
                    }
                }});
            }else{
                // Se esiste il docente in docenti già valutati dallo studente

                // Se la materia che sta valutando è già valutato dallo studente
                let mat = doc_val.materie_valutati.find((val) => val == materia);

                if(mat){
                    res.json({messaggio: "Materia del docente già valutato"}).end();
                    return;
                }else{
                    // Aggiornare la lista dei docenti valutati con la sua materia
                    utenti_collection.updateOne({email: data.email}, {$push: {
                        "docenti_valutati.$[doc].materie_valutati": materia.nomeMateria
                    }}, {
                        arrayFilters: [
                         {
                                "doc.email": valutazione.mailDocente
                            }
                        ]
                    });
                } 
            }
            
            res.json({messaggio: "Valutazione inserita con successo"}).end();
        });
});

app.post("/admin_console", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    // Se token valido ed è un amministratore
    if(data && data.tipo == "A"){ 
        mongodb.connect()
            .then(async(mongoclient) => {
                let config_collection = mongoclient.db().collection("Config");

                // Configurazione del app nel db
                let config_param = await config_collection.findOne({});
                
                // Se valutazione è terminata o non
                if(config_param.open){
                    res.json([{
                            button: "Carica dati",
                            urlEndpoint: "carica_dati"
                        },
                        {
                            button: "Stop votazioni",
                            urlEndpoint: "stop"
                        }
                    ]);
                }else{
                    res.json([{
                            button: "Carica dati",
                            urlEndpoint: "carica_dati"
                        },
                        {
                            button: "Start votazioni",
                            urlEndpoint: "start"
                        }
                    ]);
                }

                res.end();
            })

    }else{
        res.sendStatus(404).end();
    }
});

// Inizio valutazione
app.post("/start", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(data && data.tipo == "A"){ 
        mongodb.connect()
            .then(async(mongoclient) => {
                let config_collection = mongoclient.db().collection("Config");

                // Aggiorno parametro {open} a abilitato
                config_collection.updateOne({}, {$set: {open: true}});

                res.json({messaggio: "Votazione comminciate"}).end();
            }).finally()
    }else{
        res.sendStatus(404).end();
    }
});

// Termina votazione
app.post("/stop", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(data && data.tipo == "A"){ 
        mongodb.connect()
        .then(async(mongoclient) => {
            let config_collection = mongoclient.db().collection("Config");

            // Aggiorno parametro {open} a disabilitato
            config_collection.updateOne({}, {$set: {open: false}})
            res.json({messaggio: "Votazione concluse"}).end();
        });
    }else{ 
        res.sendStatus(404).end();
    }
})

app.post("/get_docenti", (req, res) => {
    let token = req.body.token;

    // Ottengo dati dal token
    let data = verifyToken(token);

    // Se token valido
    if(data){
        let {email, tipo} = data;

        // Se non è un Admin
        if(tipo != "A"){
            res.json({messaggio: "Riservato all'admin", tipo: tipo}).end();
            return;
        }

    }else{
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return;
    } 

    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Utenti");

            // Lista di tutti i docenti
            let lista_domande = await domande_collection.find({tipo: "D"}, {projection: {nome: 1, cognome: 1, email: 1, _id: 0}}).toArray();
            mongoclient.close();

            res.json(lista_domande);
            res.end();
        });
})

app.post("/view_docente", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    // Se token è valido ed è un docente
    if(data && (data.tipo == "D" || data.tipo == "A")){ 
        let email_doc = "";

        // Se è un admin invierà anche l'email del docente da visualizzare
        if(data.tipo == "A"){
            email_doc = req.body.email;
        }else{
            // Se è un docente si prende direttamente il suo emil
            email_doc = data.email;
        }

        mongodb.connect()
            .then(async(mongoclient) => {
                let utenti_collection = mongoclient.db().collection("Utenti");
                let voti_collection = mongoclient.db().collection("Voti");
                let domande_collection = mongoclient.db().collection("Domande");

                // Tutte le domande del db 
                let domande = await domande_collection.find({}).toArray();

                // Il docente interessato
                let docente = await utenti_collection.findOne({email: email_doc});
 
                // I voti del docente
                let voti = await voti_collection.findOne({email: email_doc});
 
                // Se è stato valutato
                if(voti){
                    // Per ogni materia che il docente insegna ed è stato valutato dai studenti
                    voti.materie = voti.materie.map((val) => {
                        val.valutazioni = val.valutazioni.map((valutazione) => {
                            // La descrizione della domanda che corrisponde al id_domanda
                            let domanda = domande.filter((dom) => dom.id == valutazione.id_domanda)[0];
                            // Modifica la struttura della valutazione tale che il {voto} diventa la media dei voti
                            // e la {domanda} diventa la descrizione
                            return {
                                voto: valutazione.voto.reduce((acc, curr) => acc + curr) / valutazione.voto.length,
                                domanda: domanda.domanda
                            }
                        })

                        return val;
                    });

                    // Informazioni aggiuntive
                    voti.cognome = docente.cognome;
                    voti.nome = docente.nome;
                    voti.email = docente.email;

                    res.json(voti).end();
                }else{
                    if(data.tipo == "D"){
                        res.json({messaggio: "Non hai nessun votazione"}).end();
                    }else{
                        res.json({messaggio: "Non ha nessun votazione"}).end();
                    }
                }
            });
    }
    else{   
        res.sendStatus(404).end();
    }
})
 
app.get("/carica_dati", (req, res) => {
    let cred = require("./json/credenziali.json");
    let utenti = require("./json/utenti.json");
    let domande = require("./json/domande.json");

    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Domande");
            let utenti_collection = mongoclient.db().collection("Utenti");
            let cred_collection = mongoclient.db().collection("Credenziali");
            let config_collection = mongoclient.db().collection("Config");

            await config_collection.deleteMany({});
            await domande_collection.deleteMany({});
            await utenti_collection.deleteMany({});
            await cred_collection.deleteMany({});

            domande_collection.insertMany(domande);
            utenti_collection.insertMany(utenti);
            cred_collection.insertMany(cred);
            config_collection.insertOne({open: false});

            res.json({messaggio: "Dati inseriti con successo"}).end();
        });
})

app.listen(LISTEN_PORT, () => {});